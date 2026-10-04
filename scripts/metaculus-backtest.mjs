#!/usr/bin/env node
// Shadow backtest of the bot's forecasting recipe on RESOLVED binary questions, point in time, scored against the market
// price at the same instant. Metaculus's API needs a bot token, so the replay set is Polymarket (public gamma + CLOB APIs);
// the same `score` step takes Metaculus resolved questions once a token exists.
//
//   sample   --out DIR [--n 40] [--from 2026-07-10] [--to 2026-09-18] [--lead-days 7]
//              resolved binary markets, one per event, as-of = end - lead days, market price at as-of from CLOB history
//   evidence --dir DIR [--lookback 30]
//              point-in-time headlines per question (Google News before:<as-of>, GDELT enddatetime), cached
//   run      --dir DIR --arm no-retrieval|retrieval        (needs MCP_ORIGIN/MCP_CLIENT_ID/MCP_CLIENT_SECRET)
//              every ensemble member forecasts every question; answers append to DIR/answers.jsonl, resumable
//   batches  --dir DIR --arm A --members m1,m2 [--size 10]     writes DIR/batches/*.prompt.json for a manual/other executor
//   import   --dir DIR --file answers.jsonl                    appends externally produced answers
//   score    --dir DIR [--cap 0.97 --floor 0.03 --extremize 1.0]
//              Brier/log by arm vs market, pooled ensemble, calibration, paired bootstrap, train/test Platt
//
// Contamination: the models' training cutoffs are not published to us. The sample therefore prefers markets created and
// resolved after mid-2026 and `score` prints a leak probe (accuracy of the no-retrieval arm on the markets that resolve
// EARLIEST vs LATEST), but it can never prove absence of leakage. Read the retrieval arm as the honest one.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gatherEvidence } from "../src/web-research.mjs";
import { buildPrompt, parseMember } from "../src/forecast-bot.mjs";
import { createHouseInference, DEFAULT_MEMBERS } from "../src/house-inference.mjs";
import { bootstrapMeanDiff, calibrateProbability, clamp, extremize, fitPlatt, poolProbabilities, scoreObservations } from "../src/probability-calibration.mjs";
import { brierScore, logScore } from "../src/forecasting.mjs";

const UA = "561-group-forecasting-bot/0.1 (shadow backtest; https://561.group)";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dir = val("dir", val("out", "."));
const readJson = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const writeJson = (f, v) => writeFileSync(join(dir, f), `${JSON.stringify(v, null, 1)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jget = async (url) => { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 90)}`); return r.json(); };

const NOISE = /up or down|highest temperature|lowest temperature|temperature in|tweets|how many times|price of .* (on|at) |\bspread\b|o\/u|over\/under|vs\.?\s|win on 20\d\d/iu;

function parseList(v) { return typeof v === "string" ? JSON.parse(v) : v; }

async function sample() {
  mkdirSync(dir, { recursive: true });
  const n = Number(val("n", 40)), lead = Number(val("lead-days", 7));
  const from = val("from", "2026-07-10"), to = val("to", "2026-09-18");
  const rows = [];
  // Weekly end-date slices keep each page well inside the API's page cap and spread the sample over the window.
  for (let t = Date.parse(from); t < Date.parse(to); t += 7 * 864e5) {
    const a = new Date(t).toISOString(), b = new Date(Math.min(t + 7 * 864e5, Date.parse(to))).toISOString();
    try { rows.push(...await jget(`${GAMMA}/markets?closed=true&limit=100&order=volumeNum&ascending=false&end_date_min=${a}&end_date_max=${b}&volume_num_min=${val("min-volume", 20000)}`)); } catch (e) { console.error(`slice ${a}: ${e.message}`); }
    await sleep(200);
  }
  const seenEvent = new Set();
  const cands = [];
  for (const m of rows) {
    const outcomes = parseList(m.outcomes), prices = parseList(m.outcomePrices), tokens = parseList(m.clobTokenIds ?? "[]");
    if (!outcomes || outcomes.length !== 2 || outcomes[0] !== "Yes" || outcomes[1] !== "No" || !tokens?.length) continue;
    const yes = Number(prices[0]);
    if (!(yes === 1 || yes === 0)) continue; // resolved cleanly
    if (NOISE.test(m.question) || m.umaResolutionStatus !== "resolved") continue;
    const ev = m.events?.[0]?.slug ?? m.slug;
    if (seenEvent.has(ev)) continue;
    const end = Date.parse(m.endDate), start = Date.parse(m.startDate ?? m.createdAt);
    const asOf = end - lead * 864e5;
    if (!(asOf - start >= 3 * 864e5)) continue; // market must have existed well before as-of
    seenEvent.add(ev);
    cands.push({ m, yes, end, start, asOf, tokenYes: tokens[0] });
  }
  console.error(`candidates after filters: ${cands.length} of ${rows.length}`);
  const out = [];
  for (const c of cands) {
    if (out.length >= n) break;
    try {
      const h = await jget(`${CLOB}/prices-history?market=${c.tokenYes}&startTs=${Math.floor((c.asOf - 36 * 3600e3) / 1000)}&endTs=${Math.floor(c.asOf / 1000)}&fidelity=60`);
      const pts = h.history ?? [];
      if (!pts.length) continue;
      const price = pts[pts.length - 1].p;
      if (price < 0.03 || price > 0.97) continue; // already decided at as-of: no information in the comparison
      out.push({
        id: String(c.m.id), title: c.m.question, description: String(c.m.description ?? "").slice(0, 2500),
        asOf: new Date(c.asOf).toISOString(), endDate: c.m.endDate, createdAt: c.m.createdAt, outcome: c.yes, marketPrice: price,
        marketPriceAt: new Date(pts[pts.length - 1].t * 1000).toISOString(), volume: Number(c.m.volumeNum), url: `https://polymarket.com/event/${c.m.events?.[0]?.slug ?? c.m.slug}`,
      });
    } catch (e) { console.error(`history ${c.m.id}: ${e.message}`); }
    await sleep(150);
  }
  writeJson("questions.json", out);
  const yesRate = out.reduce((s, q) => s + q.outcome, 0) / out.length;
  console.log(JSON.stringify({ questions: out.length, yesRate, firstEnd: out.map((q) => q.endDate).sort()[0], lastEnd: out.map((q) => q.endDate).sort().at(-1) }));
}

async function evidence() {
  const qs = readJson("questions.json");
  const file = join(dir, "evidence.json");
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const q of qs) {
    if (cache[q.id]) continue;
    try {
      const ev = await gatherEvidence({ title: q.title, asOf: q.asOf, lookbackDays: Number(val("lookback", 30)), fullArticles: 0, maxChars: 3500, maxItems: 12 });
      cache[q.id] = { text: ev.text, n: ev.items.length, queries: ev.queries, errors: ev.errors };
    } catch (e) { cache[q.id] = { text: "", n: 0, error: e.message }; }
    writeFileSync(file, JSON.stringify(cache));
    console.error(`${q.id} ${cache[q.id].n} items`);
  }
  console.log(JSON.stringify({ questions: qs.length, withEvidence: Object.values(cache).filter((c) => c.n > 0).length }));
}

const asQuestion = (q) => ({ type: "binary", title: q.title, description: q.description, resolutionCriteria: "", finePrint: "", unit: "", closeTime: q.endDate, resolveTime: q.endDate });
const arms = { "no-retrieval": () => "", retrieval: (ev, q) => ev[q.id]?.text ?? "" };

async function run() {
  const arm = val("arm", "retrieval");
  const qs = readJson("questions.json");
  const ev = existsSync(join(dir, "evidence.json")) ? readJson("evidence.json") : {};
  const inference = createHouseInference({ members: DEFAULT_MEMBERS.filter((m) => !m.optional) });
  if (!inference.ready) { console.error("MCP_ORIGIN/MCP_CLIENT_ID/MCP_CLIENT_SECRET absent; use `batches` + `import` or run on the node"); process.exitCode = 4; return; }
  const answers = existsSync(join(dir, "answers.jsonl")) ? readFileSync(join(dir, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(answers.map((a) => `${a.arm}|${a.member}|${a.id}`));
  const SYSTEM = "You are a calibrated superforecaster. Reply with ONE JSON object only. Keep reasoning under 80 words and put it first.";
  for (const q of qs) {
    await Promise.all(inference.members.map(async (member) => {
      if (done.has(`${arm}|${member.id}|${q.id}`)) return;
      try {
        const prompt = buildPrompt(asQuestion(q), arms[arm](ev, q), q.asOf.slice(0, 10));
        const r = await inference.ask(member, { system: SYSTEM, user: prompt, temperature: 0.4 });
        const p = parseMember({ type: "binary" }, r.text);
        if (p) appendFileSync(join(dir, "answers.jsonl"), `${JSON.stringify({ arm, member: member.id, family: member.family, id: q.id, probability: p.probability, promptTokens: r.meta.promptTokens, completionTokens: r.meta.completionTokens, ms: r.meta.ms })}\n`);
      } catch (e) { console.error(`${member.id} ${q.id}: ${e.message.slice(0, 120)}`); }
    }));
  }
}

function batches() {
  const arm = val("arm", "retrieval"), size = Number(val("size", 10));
  const memberIds = val("members", "qwen-groq,cohere-openrouter,llama-nvidia").split(",");
  const qs = readJson("questions.json");
  const ev = existsSync(join(dir, "evidence.json")) ? readJson("evidence.json") : {};
  mkdirSync(join(dir, "batches"), { recursive: true });
  const SYSTEM = "You are a calibrated superforecaster. Each item below is an independent binary question with its own as-of date. For each, give the probability it resolves YES using only the given evidence and your knowledge as of that date. Reply with ONE JSON object only: {\"answers\": [{\"id\": string, \"probability\": number 0.01-0.99}]} in the same order, no prose.";
  let count = 0;
  for (let i = 0; i < qs.length; i += size) {
    const chunk = qs.slice(i, i + size);
    const user = chunk.map((q, k) => `### Item ${k + 1} (id ${q.id})\nQuestion: ${q.title}\nAs-of date: ${q.asOf.slice(0, 10)}. Question closes: ${q.endDate.slice(0, 10)}.\nResolution rules: ${q.description.slice(0, 220).replace(/\s+/gu, " ")}\nEvidence (dated headlines before the as-of date):\n${(arms[arm](ev, q) || "(none provided)").slice(0, 800)}`).join("\n\n");
    for (const m of memberIds) {
      const member = DEFAULT_MEMBERS.find((x) => x.id === m);
      writeJson(`batches/${arm}-${m}-${String(i / size).padStart(2, "0")}.prompt.json`, { arm, member: m, family: member.family, provider: member.provider, ids: chunk.map((q) => q.id), system: SYSTEM, user });
      count += 1;
    }
  }
  console.log(JSON.stringify({ batches: count }));
}

function importAnswers() {
  const lines = readFileSync(val("file"), "utf8").split("\n").filter(Boolean);
  appendFileSync(join(dir, "answers.jsonl"), lines.map((l) => `${l}\n`).join(""));
  console.log(JSON.stringify({ imported: lines.length }));
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f3 = (x) => (x === null || x === undefined ? "  n/a" : x.toFixed(3));

function score() {
  const qs = readJson("questions.json");
  const byId = new Map(qs.map((q) => [q.id, q]));
  const answers = existsSync(join(dir, "answers.jsonl")) ? readFileSync(join(dir, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const cap = Number(val("cap", 0.97)), floor = Number(val("floor", 0.03)), ext = Number(val("extremize", 1));
  const calib = { floor, cap, extremize: ext };
  const out = [];
  const armNames = [...new Set(answers.map((a) => a.arm))];
  const loss = (p, o) => ({ brier: brierScore(p, o), log: logScore(clamp(p, 1e-4, 1 - 1e-4), o) });
  const rowsFor = (arm) => {
    const ids = [...new Set(answers.filter((a) => a.arm === arm).map((a) => a.id))];
    return ids.map((id) => {
      const q = byId.get(id);
      const mem = answers.filter((a) => a.arm === arm && a.id === id);
      const pooled = poolProbabilities(mem.map((a) => a.probability), { method: "trimmed-logit-mean" });
      return { q, mem, pooled, final: calibrateProbability(pooled, calib) };
    }).filter((r) => r.mem.length >= (arm === "no-retrieval" ? 1 : Number(val("min-members", 3))));
  };
  out.push(`# Shadow backtest: ${qs.length} resolved Polymarket binary markets, as-of = end minus lead, market price at as-of is the baseline`);
  out.push(`Questions ${qs.length}; YES rate ${f3(mean(qs.map((q) => q.outcome)))}; resolve window ${qs.map((q) => q.endDate).sort()[0].slice(0, 10)} to ${qs.map((q) => q.endDate).sort().at(-1).slice(0, 10)}; calibration: floor ${floor} cap ${cap} extremize ${ext}`);
  out.push("");
  out.push("| Arm | Forecaster | n | Brier | Log loss |");
  out.push("| --- | --- | ---: | ---: | ---: |");
  const detail = {};
  for (const arm of armNames) {
    const rows = rowsFor(arm);
    if (!rows.length) continue;
    const market = rows.map((r) => loss(clamp(r.q.marketPrice, 0.01, 0.99), r.q.outcome));
    const bounded50 = rows.map((r) => loss(0.5, r.q.outcome));
    const pooled = rows.map((r) => loss(r.pooled, r.q.outcome));
    const final = rows.map((r) => loss(r.final, r.q.outcome));
    const line = (name, ls) => out.push(`| ${arm} | ${name} | ${rows.length} | ${f3(mean(ls.map((x) => x.brier)))} | ${f3(mean(ls.map((x) => x.log)))} |`);
    line("market price at as-of", market);
    line("always 0.50", bounded50);
    const families = [...new Set(rows.flatMap((r) => r.mem.map((a) => a.member)))];
    for (const m of families) {
      const ls = rows.map((r) => r.mem.find((a) => a.member === m)).filter(Boolean).map((a) => loss(clamp(a.probability, 0.01, 0.99), byId.get(a.id).outcome));
      out.push(`| ${arm} | member ${m} | ${ls.length} | ${f3(mean(ls.map((x) => x.brier)))} | ${f3(mean(ls.map((x) => x.log)))} |`);
    }
    line("ensemble pooled", pooled);
    line("ensemble calibrated (bot output)", final);
    const diffs = final.map((x, i) => x.brier - market[i].brier);
    const bs = bootstrapMeanDiff(diffs);
    detail[arm] = { rows, bs, final, market };
  }
  out.push("");
  out.push("Paired difference in Brier, bot minus market (negative = bot better), 95% bootstrap interval over questions:");
  for (const [arm, d] of Object.entries(detail)) out.push(`- ${arm}: ${f3(d.bs.mean)} [${f3(d.bs.lo)}, ${f3(d.bs.hi)}] over n=${d.rows.length}`);
  // Calibration choice on a split: fit Platt on the earlier half, test on the later half.
  for (const [arm, d] of Object.entries(detail)) {
    const sorted = [...d.rows].sort((a, b) => a.q.endDate.localeCompare(b.q.endDate));
    const half = Math.floor(sorted.length / 2);
    const train = sorted.slice(0, half).map((r) => ({ probability: r.pooled, outcome: r.q.outcome }));
    const test = sorted.slice(half);
    const platt = fitPlatt(train, { minN: 10 });
    if (!platt || !test.length) continue;
    const base = test.map((r) => loss(calibrateProbability(r.pooled, calib), r.q.outcome).brier);
    const fitted = test.map((r) => loss(calibrateProbability(r.pooled, { ...calib, platt }), r.q.outcome).brier);
    const mkt = test.map((r) => loss(clamp(r.q.marketPrice, 0.01, 0.99), r.q.outcome).brier);
    out.push(`- ${arm} Platt (fit on earlier ${train.length}, test on later ${test.length}): a=${platt.a.toFixed(2)} b=${platt.b.toFixed(2)}; test Brier identity ${f3(mean(base))}, Platt ${f3(mean(fitted))}, market ${f3(mean(mkt))}`);
    for (const a of [0.8, 1.2, 1.5]) out.push(`  extremize x${a} on test: Brier ${f3(mean(test.map((r) => loss(clamp(extremize(r.pooled, a), floor, cap), r.q.outcome).brier)))}`);
  }
  if (detail["no-retrieval"]) {
    const rows = [...detail["no-retrieval"].rows].sort((a, b) => a.q.endDate.localeCompare(b.q.endDate));
    const h = Math.floor(rows.length / 2);
    const acc = (rs) => mean(rs.map((r) => ((r.pooled > 0.5) === (r.q.outcome === 1) ? 1 : 0)));
    out.push("");
    out.push(`Leak probe (no-retrieval arm): directional accuracy on the earlier-resolving half ${f3(acc(rows.slice(0, h)))} vs the later half ${f3(acc(rows.slice(h)))}. Higher accuracy on EARLIER questions than later ones would suggest the models remember outcomes; it is a weak probe, not proof either way.`);
  }
  const tok = answers.filter((a) => a.promptTokens);
  if (tok.length) out.push(`\nMeasured tokens per member call: prompt ${Math.round(mean(tok.map((a) => a.promptTokens)))}, completion ${Math.round(mean(tok.map((a) => a.completionTokens)))} (n=${tok.length}).`);
  const text = out.join("\n");
  writeFileSync(join(dir, "RESULT.md"), `${text}\n`);
  console.log(text);
}

const table = { sample, evidence, run, batches, import: importAnswers, score };
if (!table[cmd]) { console.error(`usage: ${Object.keys(table).join("|")} ...`); process.exitCode = 2; } else await table[cmd]();
