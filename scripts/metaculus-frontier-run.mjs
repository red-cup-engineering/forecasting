#!/usr/bin/env node
// Resumable batch runner for the frontier backtest. Sends the prompts that `metaculus-backtest.mjs batches` wrote
// (batches/<arm>-<member>-NN.prompt.json) through the house inference dispatch and appends parsed answers to
// answers.jsonl. A refused or "concurrency bound is occupied" delivery is retried with exponential backoff (capped at
// --max-wait-min per attempt gap, default 15 s: the carrier slot is free only ~10 s in every ~4 min, so poll densely) for up to --give-up-hours, so a single-slot subscription carrier (Antigravity) that
// other node work holds back to back is waited for rather than dropped.
//
//   set -a; . "$CREDENTIALS_DIRECTORY/bare-cedar-fog.561.group-mcp-client.env"; set +a
//   node scripts/metaculus-frontier-run.mjs --dir data/records/2026-10-04-metaculus-bot-shadow-backtest \
//        --members gemini-antigravity --arms retrieval,no-retrieval [--give-up-hours 6]
//
// Needs MCP_ORIGIN / MCP_CLIENT_ID / MCP_CLIENT_SECRET (exit 4 otherwise). Never submits anywhere else.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHouseInference, DEFAULT_MEMBERS, parseJsonLoose } from "../src/house-inference.mjs";

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dir = val("dir", "data/records/2026-10-04-metaculus-bot-shadow-backtest");
const memberIds = val("members", "gemini-antigravity,gpt-codex").split(",");
const arms = val("arms", "retrieval,no-retrieval").split(",");
const giveUpMs = Number(val("give-up-hours", 6)) * 3_600_000;
const maxWaitMs = Number(val("max-wait-min", 0.25)) * 60_000;
const tag = val("run", "2026-10-04-frontier");

const inference = createHouseInference({ members: DEFAULT_MEMBERS, timeoutMs: 240_000 });
if (!inference.ready) { console.error("MCP_ORIGIN/MCP_CLIENT_ID/MCP_CLIENT_SECRET absent"); process.exit(4); }
const file = join(dir, "answers.jsonl");
const answers = () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();

for (const arm of arms) {
  for (const id of memberIds) {
    const member = inference.members.find((m) => m.id === id);
    if (!member) { console.error(`unknown member ${id}`); continue; }
    const files = readdirSync(join(dir, "batches")).filter((f) => f.startsWith(`${arm}-${id}-`) && f.endsWith(".prompt.json")).sort();
    for (const f of files) {
      const batch = JSON.parse(readFileSync(join(dir, "batches", f), "utf8"));
      const have = new Set(answers().filter((a) => a.arm === arm && a.member === id).map((a) => a.id));
      if (batch.ids.every((x) => have.has(x))) continue;
      let wait = 5_000;
      for (;;) {
        try {
          const t0 = Date.now();
          const r = await inference.ask(member, { system: batch.system, user: batch.user, temperature: 0.4 });
          const parsed = parseJsonLoose(r.text);
          const rows = (parsed?.answers ?? []).filter((a) => batch.ids.includes(String(a.id)) && Number.isFinite(Number(a.probability)));
          if (rows.length < batch.ids.length) throw new Error(`parsed ${rows.length}/${batch.ids.length}`);
          const seen = new Set();
          for (const a of rows) {
            if (seen.has(String(a.id))) continue;
            seen.add(String(a.id));
            appendFileSync(file, `${JSON.stringify({ arm, member: id, family: member.family, id: String(a.id), probability: Math.min(0.99, Math.max(0.01, Number(a.probability))), batchMs: r.meta.ms ?? Date.now() - t0, promptTokens: r.meta.promptTokens, completionTokens: r.meta.completionTokens, batchItems: rows.length, run: tag })}\n`);
          }
          console.error(`${arm} ${id} ${f}: ok in ${r.meta.ms} ms`);
          break;
        } catch (e) {
          if (Date.now() - started > giveUpMs) { console.error(`${arm} ${id} ${f}: gave up (${e.message.slice(0, 100)})`); process.exit(3); }
          console.error(`${arm} ${id} ${f}: ${e.message.slice(0, 100)}; retry in ${Math.round(wait / 1000)} s`);
          await sleep(wait);
          wait = Math.min(maxWaitMs, wait * 2);
        }
      }
    }
  }
}
