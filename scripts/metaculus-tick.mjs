#!/usr/bin/env node
// One poll of the Metaculus tournament bot: find open tournament questions, forecast new ones once, update when new
// evidence arrives (always one final pass in the last minutes before close, because only the last forecast before close
// is scored), and record everything to machine state. Dry-run (the default) writes the would-submit payload and
// comment instead of POSTing; --live is the only way a forecast leaves this machine, and it also needs METACULUS_TOKEN.
//
//   node scripts/metaculus-tick.mjs [--live] [--tournaments 33121,minibench] [--state-dir DIR] [--fixture posts.json]
//
// Exit codes: 0 ok, 3 METACULUS_TOKEN absent (cannot even read), 4 house inference credentials absent, 1 other failure.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMetaculusClient, flattenPost, MetaculusTokenAbsentError } from "../src/metaculus-client.mjs";
import { forecastQuestion } from "../src/forecast-bot.mjs";
import { createHouseInference } from "../src/house-inference.mjs";
import { gatherEvidence } from "../src/web-research.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = resolve(HERE, "../content/config/metaculus-bot.json");
export const loadConfig = () => JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
export const expandHome = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

export function openState(dir) {
  for (const sub of ["questions", "would-submit"]) mkdirSync(join(dir, sub), { recursive: true });
  const qfile = (id) => join(dir, "questions", `${id}.json`);
  return {
    dir,
    load: (id) => (existsSync(qfile(id)) ? JSON.parse(readFileSync(qfile(id), "utf8")) : null),
    save: (id, state) => writeFileSync(qfile(id), `${JSON.stringify(state, null, 2)}\n`),
    event: (event) => appendFileSync(join(dir, "ledger.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`),
    usage: (row) => appendFileSync(join(dir, "usage.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`),
    wouldSubmit: (id, body) => { const f = join(dir, "would-submit", `${id}-${Date.now()}.json`); writeFileSync(f, `${JSON.stringify(body, null, 2)}\n`); return f; },
  };
}

const minutes = (ms) => ms / 60000;
const probOf = (f) => f?.payload?.probability_yes ?? null;

/**
 * Decides what to do with one question this tick: "new" | "recheck" | "final" | "skip" (with reason).
 */
export function decide(q, state, now, tick) {
  const closeMs = q.closeTime ? Date.parse(q.closeTime) : null;
  if (closeMs !== null && closeMs <= now) return { act: "skip", reason: "closed" };
  const toClose = closeMs === null ? Infinity : minutes(closeMs - now);
  if (!state || state.forecasts.length === 0) {
    if (toClose < tick.minMinutesBeforeCloseToStart) return { act: "skip", reason: `only ${toClose.toFixed(0)} min to close` };
    return { act: "new" };
  }
  const last = state.forecasts[state.forecasts.length - 1];
  const since = minutes(now - Date.parse(last.at));
  if (toClose <= tick.finalWindowMinutes && !state.finalDone && since >= 3) return { act: "final" };
  if (since >= tick.recheckMinutes) return { act: "recheck" };
  return { act: "skip", reason: `forecast ${since.toFixed(0)} min ago` };
}

export async function runTick({ client, questions, inference, research, config, state, live, now = Date.now(), log = console.error }) {
  const tick = config.tick;
  const summary = { considered: questions.length, forecast: 0, updated: 0, skipped: 0, failed: 0, submitted: 0, dryRun: !live };
  const order = [...questions].sort((a, b) => (Date.parse(a.closeTime ?? 0) || Infinity) - (Date.parse(b.closeTime ?? 0) || Infinity));
  let newCount = 0;
  const deadline = Date.now() + (tick.budgetSeconds ?? 420) * 1000;
  for (const q of order) {
    if (Date.now() > deadline) { summary.deferred = (summary.deferred ?? 0) + 1; continue; }
    const st = state.load(q.questionId) ?? { question: null, forecasts: [], finalDone: false };
    const d = decide(q, st, now, tick);
    if (d.act === "skip") { summary.skipped += 1; continue; }
    if (d.act === "new" && newCount >= tick.maxNewQuestionsPerTick) { summary.skipped += 1; continue; }
    if (d.act === "new") newCount += 1;
    const asOf = new Date(now).toISOString();
    try {
      const prior = st.forecasts[st.forecasts.length - 1];
      const out = await forecastQuestion(q, { inference, research, config: config.bot, asOf, log, unlessFingerprint: d.act === "new" ? null : (prior?.fingerprint ?? null) });
      if (out.unchanged) { if (d.act === "final") { st.finalDone = true; state.save(q.questionId, st); } summary.skipped += 1; state.event({ kind: "evidence-unchanged", questionId: q.questionId, act: d.act }); continue; }
      for (const m of out.members) state.usage({ questionId: q.questionId, ...m });
      if (!out.ok) { summary.failed += 1; state.event({ kind: "forecast-refused", questionId: q.questionId, postId: q.postId, reason: out.reason }); continue; }
      const last = st.forecasts[st.forecasts.length - 1];
      const changed = !last || last.fingerprint !== out.fingerprint;
      const material = !last || q.type !== "binary" || Math.abs(out.probability - probOf(last)) >= tick.materialChangeProbability;
      const isFinal = d.act === "final";
      if (last && !isFinal && !(changed && material)) { summary.skipped += 1; state.event({ kind: "unchanged", questionId: q.questionId, act: d.act, changed, material }); continue; }
      const body = { postId: q.postId, questionId: q.questionId, type: q.type, title: q.title, closeTime: q.closeTime, pageUrl: q.pageUrl, payload: out.payload, comment: out.comment, summary: out.summary, members: out.members, queries: out.evidence.queries };
      const row = { at: new Date(now).toISOString(), act: d.act, summary: out.summary, fingerprint: out.fingerprint, payload: out.payload, submitted: false, dry: !live };
      if (live) {
        await client.postForecast(q, out.payload);
        row.submitted = true;
        summary.submitted += 1;
        try { await client.postComment(q.postId, out.comment); row.commented = true; } catch (e) { row.commentError = e.message; log(`comment failed on ${q.postId}: ${e.message}`); }
      } else {
        row.wouldSubmitFile = state.wouldSubmit(q.questionId, body);
      }
      st.question = { postId: q.postId, questionId: q.questionId, type: q.type, title: q.title, closeTime: q.closeTime, pageUrl: q.pageUrl };
      st.forecasts.push(row);
      if (isFinal) st.finalDone = true;
      state.save(q.questionId, st);
      state.event({ kind: live ? "submitted" : "dry-run", questionId: q.questionId, postId: q.postId, act: d.act, summary: out.summary });
      if (d.act === "new") summary.forecast += 1; else summary.updated += 1;
    } catch (e) {
      summary.failed += 1;
      state.event({ kind: "error", questionId: q.questionId, postId: q.postId, error: String(e.message).slice(0, 400) });
      log(`question ${q.questionId}: ${e.message}`);
    }
  }
  state.event({ kind: "tick", ...summary });
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const config = loadConfig();
  const live = flag("live");
  const state = openState(expandHome(val("state-dir", config.state.dir)));
  const tournaments = val("tournaments") ? val("tournaments").split(",").map((t) => (/^\d+$/u.test(t) ? Number(t) : t)) : config.tournaments;
  const client = createMetaculusClient();
  let questions = [];
  try {
    if (val("fixture")) questions = JSON.parse(readFileSync(val("fixture"), "utf8")).flatMap(flattenPost);
    else for (const t of tournaments) questions.push(...await client.listOpenQuestions(t));
  } catch (e) {
    if (e instanceof MetaculusTokenAbsentError) { console.error(e.message); process.exitCode = 3; return; }
    throw e;
  }
  if (live && !client.hasToken) { console.error("--live requires METACULUS_TOKEN"); process.exitCode = 3; return; }
  const inference = createHouseInference({ members: config.members, usageSink: () => {} });
  if (!inference.ready) { console.error("house inference credentials (MCP_ORIGIN, MCP_CLIENT_ID, MCP_CLIENT_SECRET) are absent"); process.exitCode = 4; return; }
  const research = (q, { asOf }) => gatherEvidence({ title: q.title, asOf: null, lookbackDays: 30 });
  const summary = await runTick({ client, questions, inference, research, config, state, live });
  console.log(JSON.stringify(summary));
}

if (import.meta.main) main().catch((e) => { console.error(`[${new Date().toISOString()}] tick failed: ${e.message}`); process.exitCode = 1; });
