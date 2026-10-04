#!/usr/bin/env node
// Frontier-member analysis of the 2026-10-04 shadow backtest: per-model and ensemble Brier with paired bootstrap
// intervals against the market price, and the "other forecasts as input" anchor test (logit blend of bot and market with
// the weight fit on one half and scored on the other, both directions).
//
//   node scripts/metaculus-frontier-analysis.mjs --dir data/records/2026-10-04-metaculus-bot-shadow-backtest [--write FRONTIER-RESULT.md]
//
// Reads questions.json and answers.jsonl; answers of arm "retrieval-repeat" are a variance probe and never enter tables.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapMeanDiff, clamp, expit, logit, poolProbabilities } from "../src/probability-calibration.mjs";
import { brierScore, logScore } from "../src/forecasting.mjs";

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dir = val("dir", "data/records/2026-10-04-metaculus-bot-shadow-backtest");
const qs = JSON.parse(readFileSync(join(dir, "questions.json"), "utf8"));
const answers = readFileSync(join(dir, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(qs.map((q) => [q.id, q]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f3 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(3));
const mk = (q) => clamp(q.marketPrice, 0.02, 0.98);
const cl = (p) => clamp(p, 0.01, 0.99);

const FRONTIER = ["gemini-antigravity", "gpt-codex", "qwen-groq"];
const ZERO_CASH = ["qwen-groq", "llama-nvidia"];

function memberMap(arm) {
  const m = new Map();
  for (const a of answers) {
    if (a.arm !== arm) continue;
    if (!m.has(a.member)) m.set(a.member, new Map());
    m.get(a.member).set(a.id, a.probability);
  }
  return m;
}

/** Forecast vectors per question id for each named forecaster (members and ensembles), over the ids each one covers. */
function forecasters(arm) {
  const mm = memberMap(arm);
  const out = new Map();
  for (const [name, ids] of mm) out.set(name, ids);
  const ens = (name, members) => {
    if (!members.every((x) => mm.has(x))) return;
    const common = [...mm.get(members[0]).keys()].filter((id) => members.every((x) => mm.get(x).has(id)));
    if (common.length < 10) return;
    out.set(name, new Map(common.map((id) => [id, poolProbabilities(members.map((x) => mm.get(x).get(id)), { method: "trimmed-logit-mean" })])));
  };
  ens("ENSEMBLE frontier (gemini+gpt+qwen)", FRONTIER);
  ens("ENSEMBLE gemini+gpt", ["gemini-antigravity", "gpt-codex"]);
  ens("ENSEMBLE gpt+qwen", ["gpt-codex", "qwen-groq"]);
  ens("ENSEMBLE zero-cash (qwen+llama)", ZERO_CASH);
  return out;
}

const loss = (p, o) => brierScore(p, o);

/** Weight w in [0,1] minimising Brier of expit(w*logit(bot)+(1-w)*logit(market)) on the rows. */
function fitBlend(rows) {
  let best = { w: 0, b: Infinity };
  for (let i = 0; i <= 20; i += 1) {
    const w = i / 20;
    const b = mean(rows.map((r) => loss(clamp(expit(w * logit(cl(r.p)) + (1 - w) * logit(mk(r.q))), 0.01, 0.99), r.q.outcome)));
    if (b < best.b - 1e-12) best = { w, b };
  }
  return best.w;
}

/** Cross-fit blend: fit on fold A score on fold B and the reverse. Folds: chronological halves, or alternating. */
function crossfit(rows, kind) {
  const sorted = [...rows].sort((a, b) => a.q.endDate.localeCompare(b.q.endDate));
  const A = kind === "chrono" ? sorted.slice(0, Math.floor(sorted.length / 2)) : sorted.filter((_, i) => i % 2 === 0);
  const B = kind === "chrono" ? sorted.slice(Math.floor(sorted.length / 2)) : sorted.filter((_, i) => i % 2 === 1);
  const wA = fitBlend(A), wB = fitBlend(B);
  const pred = (r, w) => clamp(expit(w * logit(cl(r.p)) + (1 - w) * logit(mk(r.q))), 0.01, 0.99);
  const scored = [...A.map((r) => ({ r, p: pred(r, wB) })), ...B.map((r) => ({ r, p: pred(r, wA) }))];
  return { wA, wB, scored };
}

const lines = [];
const out = (s = "") => lines.push(s);
out("# Frontier-member shadow backtest: per-model and ensemble skill against the market, and the market-anchor test");
out("");
out(`Questions: ${qs.length} (the same 40 resolved Polymarket binaries, same as-of dates and evidence as RESULT.md). Market baseline = CLOB price at as-of (clamped 0.02-0.98). Intervals: paired bootstrap over questions, 2000 resamples, 95%. Negative difference = forecaster better than the market.`);
out("");

for (const arm of ["retrieval", "no-retrieval"]) {
  const F = forecasters(arm);
  out(`## Arm: ${arm}`);
  out("");
  out("| Forecaster | n | Brier | Log loss | Market Brier (same n) | Diff vs market [95% CI] |");
  out("| --- | ---: | ---: | ---: | ---: | --- |");
  const rowsOf = (m) => [...m].map(([id, p]) => ({ q: byId.get(id), p })).filter((r) => r.q);
  const refRows = rowsOf(F.values().next().value ?? new Map());
  if (refRows.length) {
    const n = refRows.length;
    out(`| always 0.50 | ${n} | 0.250 | 0.693 | | |`);
  }
  const anchorRows = [];
  for (const [name, m] of F) {
    const rows = rowsOf(m);
    if (rows.length < 10) continue;
    const bl = rows.map((r) => loss(cl(r.p), r.q.outcome));
    const ml = rows.map((r) => loss(mk(r.q), r.q.outcome));
    const ll = mean(rows.map((r) => logScore(cl(r.p), r.q.outcome)));
    const bs = bootstrapMeanDiff(bl.map((x, i) => x - ml[i]));
    out(`| ${name} | ${rows.length} | ${f3(mean(bl))} | ${f3(ll)} | ${f3(mean(ml))} | ${f3(bs.mean)} [${f3(bs.lo)}, ${f3(bs.hi)}] |`);
    anchorRows.push([name, rows]);
  }
  out("");
  out(`### Bot plus market anchor (logit blend, weight on the bot fit on one half, scored on the other, both directions), arm ${arm}`);
  out("");
  out("| Forecaster | n | Fold | w on bot (fold A / fold B) | Blend Brier | Market Brier | Blend minus market [95% CI] |");
  out("| --- | ---: | --- | --- | ---: | ---: | --- |");
  for (const [name, rows] of anchorRows) {
    if (rows.length < 20) continue;
    for (const kind of ["chrono", "alternate"]) {
      const cf = crossfit(rows, kind);
      const bl = cf.scored.map((s) => loss(s.p, s.r.q.outcome));
      const ml = cf.scored.map((s) => loss(mk(s.r.q), s.r.q.outcome));
      const bs = bootstrapMeanDiff(bl.map((x, i) => x - ml[i]));
      out(`| ${name} | ${rows.length} | ${kind} | ${cf.wA.toFixed(2)} / ${cf.wB.toFixed(2)} | ${f3(mean(bl))} | ${f3(mean(ml))} | ${f3(bs.mean)} [${f3(bs.lo)}, ${f3(bs.hi)}] |`);
    }
  }
  out("");
  out("In-sample full-data weight (an optimistic ceiling, not an estimate): " + anchorRows.filter(([, r]) => r.length >= 20).map(([n, r]) => `${n} w=${fitBlend(r.map((x) => x)).toFixed(2)}`).join("; "));
  out("");
}

// Contamination: leak probe by resolution half, no-retrieval arm.
out("## Contamination checks");
out("");
{
  const F = forecasters("no-retrieval");
  out("Leak probe, no-retrieval arm. Directional accuracy (p>0.5 vs outcome) and mean Brier on the earlier-resolving half versus the later half. Remembered outcomes would make the EARLIER half better; as-of dates run 2026-06-14 to 2026-09-13; see the cutoff table below for which models that is safely after.");
  out("");
  out("| Forecaster | n | acc early | acc late | Brier early | Brier late |");
  out("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const [name, m] of F) {
    const rows = [...m].map(([id, p]) => ({ q: byId.get(id), p })).filter((r) => r.q).sort((a, b) => a.q.endDate.localeCompare(b.q.endDate));
    if (rows.length < 20) continue;
    const h = Math.floor(rows.length / 2);
    const acc = (rs) => mean(rs.map((r) => ((r.p > 0.5) === (r.q.outcome === 1) ? 1 : 0)));
    const br = (rs) => mean(rs.map((r) => loss(cl(r.p), r.q.outcome)));
    out(`| ${name} | ${rows.length} | ${f3(acc(rows.slice(0, h)))} | ${f3(acc(rows.slice(h)))} | ${f3(br(rows.slice(0, h)))} | ${f3(br(rows.slice(h)))} |`);
  }
  out("");
  // Retrieval-vs-no-retrieval lift, and run-to-run noise from the repeat probe.
  const R = memberMap("retrieval"), N = memberMap("no-retrieval"), P = memberMap("retrieval-repeat");
  out("Retrieval lift (Brier no-retrieval minus retrieval, same questions; positive = headlines helped):");
  for (const name of R.keys()) {
    if (!N.has(name)) continue;
    const ids = [...N.get(name).keys()].filter((id) => R.get(name).has(id) && byId.has(id));
    if (ids.length < 10) continue;
    const d = ids.map((id) => loss(cl(N.get(name).get(id)), byId.get(id).outcome) - loss(cl(R.get(name).get(id)), byId.get(id).outcome));
    out(`- ${name}: ${f3(mean(d))} over n=${ids.length}`);
  }
  for (const [name, rep] of P) {
    const base = R.get(name);
    if (!base) continue;
    const ids = [...rep.keys()].filter((id) => base.has(id));
    const sd = Math.sqrt(mean(ids.map((id) => (rep.get(id) - base.get(id)) ** 2)));
    out(`- repeat-call noise ${name} (same prompt text, two calls, n=${ids.length}): RMS probability difference ${f3(sd)}; Brier call 1 ${f3(mean(ids.map((id) => loss(cl(base.get(id)), byId.get(id).outcome))))} vs call 2 ${f3(mean(ids.map((id) => loss(cl(rep.get(id)), byId.get(id).outcome))))}`);
  }
}
out("");
out("Provider-stated cutoffs (web search 2026-10-04; none verified by us):");
out("");
out("| Member | Model as routed | Stated cutoff | Source | Safe margin before first as-of 2026-06-14 |");
out("| --- | --- | --- | --- | --- |");
out("| gemini-antigravity | gemini-3.1-pro-high (agy) | Jan 2025 | Gemini 3 Pro model card; 3.1 listings | yes, 17 months |");
out("| gpt-codex | Codex 'default' (model name opaque to the dispatch; self-report: GPT-5-based, cutoff unknown, latest event Jul 2024) | GPT-5-Codex Sep 30 2024; GPT-5.5 Dec 2025 (Codex issue #24930 reports 'June 2024' self-claims) | OpenAI model docs | yes under either, 6+ months |");
out("| qwen-groq | qwen/qwen3.8-27b | NOT published; model released 2026-08-14; self-report 'cutoff 2026, World Cup began June 2026' | Qwen HF discussion, kingy.ai | NO: cannot rule out that training data includes events before the as-of dates, or after early ones |");
out("| llama-nvidia | meta/llama-3.2-11b-vision-instruct | Dec 2023 | Meta model card | yes |");
out("");
out("Consequence: Qwen no-retrieval answers are not clean point-in-time forecasts. Frontier Gemini and GPT answers are, to the extent the stated cutoffs are true. Qwen's retrieval-arm score is unaffected by this except through the same possible memory.");
out("");
// Latency and calls.
out("## Calls and latency (this run's answers carry batchMs; earlier Qwen/Llama rows carry token counts only)");
out("");
out("| Arm | Member | batch calls | median ms | total ms |");
out("| --- | --- | ---: | ---: | ---: |");
{
  const keyed = new Map();
  for (const a of answers) {
    if (!a.batchMs) continue;
    const k = `${a.arm}|${a.member}`;
    if (!keyed.has(k)) keyed.set(k, new Set());
    keyed.get(k).add(a.batchMs);
  }
  for (const [k, s] of keyed) {
    const v = [...s].sort((a, b) => a - b);
    const [arm, member] = k.split("|");
    out(`| ${arm} | ${member} | ${v.length} | ${v[Math.floor(v.length / 2)]} | ${v.reduce((x, y) => x + y, 0)} |`);
  }
}
const text = lines.join("\n");
console.log(text);
if (val("write", "")) writeFileSync(join(dir, val("write", "")), `${text}\n`);
