/**
 * Agent core of the Metaculus tournament bot: one question in, one submittable forecast plus a reasoning comment out.
 *
 *   research (keyless web evidence)  ->  N members (>= 3 model families, via the house inference market, in parallel)
 *   -> pool -> calibrate LAST -> payload in the exact Metaculus shape -> private reasoning comment
 *
 * Pure of the network except through injected `inference` (house-inference.mjs) and `research` (web-research.mjs
 * gatherEvidence), so backtests and tests inject point-in-time or stub versions of both.
 * Reuses: ./probability-calibration.mjs (pool/extremize/cap/Platt), ./metaculus-cdf.mjs (numeric CDF),
 * ./evidence-fusion.mjs (SignChain conflict flag over member estimates), ./forecasting.mjs via calibration scoring.
 */

import { fuseEvidenceToForecast } from "./evidence-fusion.mjs";
import { calibrateOptionVector, calibrateProbability, poolProbabilities, clamp } from "./probability-calibration.mjs";
import { STANDARD_PERCENTILES, aggregatePercentileSets, cdfFromPercentiles, cdfQuantile, locationToValue } from "./metaculus-cdf.mjs";
import { parseJsonLoose } from "./house-inference.mjs";
import { assertPayloadFitsQuestion } from "./metaculus-client.mjs";

export const DEFAULT_BOT_CONFIG = Object.freeze({
  minMembers: 3,
  samplesPerMember: 1,
  temperature: 0.4,
  pool: "trimmed-logit-mean",
  calibration: { extremize: 1, platt: null, floor: 0.03, cap: 0.97 },
  optionCalibration: { floor: 0.01, shrink: 0.05 },
});

const SYSTEM = `You are a calibrated superforecaster entering a bot tournament scored by peer score. Rules of craft:
- Start from the base rate for the reference class, then adjust with the dated evidence given. Evidence marked with dates is newer than your training data: when it conflicts with your memory, trust the evidence.
- Prefer the status quo when little time remains; avoid both false precision and reflexive 50% hedging. Never state 0% or 100%.
- Think about how the question will actually be resolved (resolution criteria and fine print), not what is generally true.
Reply with ONE JSON object only, no prose outside it. Keep "reasoning" under 120 words and put it first.`;

const fmt = (x) => (typeof x === "number" ? String(Math.round(x * 1e6) / 1e6) : String(x));

function describeQuestion(q, asOf) {
  const lines = [
    `Question: ${q.title}`,
    q.description && `Background: ${q.description.slice(0, 2500)}`,
    q.resolutionCriteria && `Resolution criteria: ${q.resolutionCriteria.slice(0, 1500)}`,
    q.finePrint && `Fine print: ${q.finePrint.slice(0, 1000)}`,
    q.unit && `Unit: ${q.unit}`,
    `Question closes: ${q.closeTime ?? "unknown"}; resolves: ${q.resolveTime ?? "unknown"}`,
    `Current date: ${asOf}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function numericRangeText(q) {
  const s = q.scaling;
  const show = (v) => (q.type === "date" ? new Date(v * 1000).toISOString().slice(0, 10) : fmt(v));
  return `Range: ${show(s.rangeMin)} to ${show(s.rangeMax)} (lower bound ${q.openLower ? "OPEN: values below are possible" : "closed"}, upper bound ${q.openUpper ? "OPEN: values above are possible" : "closed"})${s.zeroPoint !== null ? "; the scale is logarithmic, so think in multiples" : ""}.`;
}

export function buildPrompt(q, evidenceText, asOf) {
  const head = describeQuestion(q, asOf);
  const ev = `Evidence (headlines/articles, newest first; may be incomplete or noisy):\n${evidenceText || "(none found)"}`;
  if (q.type === "binary") {
    return `${head}\n\n${ev}\n\nGive the probability the question resolves YES. JSON: {"reasoning": string, "probability": number between 0.01 and 0.99, "confidence": number 0..1}`;
  }
  if (q.type === "multiple_choice") {
    return `${head}\nOptions: ${JSON.stringify(q.options)}\n\n${ev}\n\nGive a probability for each option (they must sum to 1; leave a little mass on every option). JSON: {"reasoning": string, "probabilities": {<option text exactly as listed>: number}}`;
  }
  const dateNote = q.type === "date" ? " Give each value as an ISO date YYYY-MM-DD." : " Give plain numbers in the stated unit, no units or commas.";
  return `${head}\n${numericRangeText(q)}\n\n${ev}\n\nGive your 10th, 20th, 40th, 60th, 80th and 90th percentile values of the outcome (strictly increasing, wide enough to be honest about uncertainty).${dateNote} JSON: {"reasoning": string, "percentiles": {"10": v, "20": v, "40": v, "60": v, "80": v, "90": v}}`;
}

function parseNumber(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[, $%]/gu, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Parses one member's JSON for the question type; returns null when unusable. */
export function parseMember(q, text) {
  const j = parseJsonLoose(text);
  if (!j) return null;
  const reasoning = String(j.reasoning ?? "").slice(0, 900);
  if (q.type === "binary") {
    const p = parseNumber(j.probability);
    if (!Number.isFinite(p)) return null;
    return { probability: clamp(p > 1 && p <= 100 ? p / 100 : p, 0.005, 0.995), confidence: clamp(parseNumber(j.confidence) || 0.5, 0.05, 1), reasoning };
  }
  if (q.type === "multiple_choice") {
    const m = j.probabilities;
    if (!m || typeof m !== "object") return null;
    const vec = {};
    for (const o of q.options) {
      const hit = Object.keys(m).find((k) => k === o) ?? Object.keys(m).find((k) => k.trim().toLowerCase() === o.trim().toLowerCase());
      vec[o] = hit === undefined ? NaN : parseNumber(m[hit]);
    }
    if (q.options.some((o) => !Number.isFinite(vec[o]))) return null;
    return { vector: vec, reasoning };
  }
  const raw = j.percentiles;
  if (!raw || typeof raw !== "object") return null;
  const set = [];
  for (const p of STANDARD_PERCENTILES) {
    const key = Object.keys(raw).find((k) => Math.abs(parseNumber(k) / 100 - p) < 1e-9);
    if (key === undefined) continue;
    const value = q.type === "date" ? Date.parse(String(raw[key])) / 1000 : parseNumber(raw[key]);
    if (Number.isFinite(value)) set.push({ percentile: p, value });
  }
  if (set.length < 3) return null;
  for (let i = 1; i < set.length; i += 1) if (set[i].value < set[i - 1].value) set[i].value = set[i - 1].value;
  return { percentiles: set, reasoning };
}

const first = (s, n) => String(s ?? "").replace(/\s+/gu, " ").slice(0, n);

function composeComment(q, { evidence, results, summary }) {
  const lines = [
    `Automated forecast by the 561 Group research bot (house-inference ensemble, ${results.length} members, no human in the loop).`,
    `Final: ${summary}`,
    "",
    "Members:",
    ...results.map((r) => `- ${r.meta.family} (${r.meta.model}): ${r.summary}. ${first(r.parsed.reasoning, 380)}`),
    "",
    `Evidence considered (${evidence.items.length} items; queries: ${evidence.queries.join(" | ")}):`,
    ...evidence.items.slice(0, 8).map((i) => `- [${i.publishedAt?.slice(0, 10) ?? "?"}] ${first(i.title, 140)} (${i.source || i.origin})`),
    "",
    "Method: members forecast independently from the same dated evidence; probabilities are pooled in log-odds, then calibrated (bounded extremes) as the last step.",
  ];
  return lines.join("\n").slice(0, 9000);
}

/**
 * @returns {Promise<{ok:true, payload:object, comment:string, summary:string, probability?:number, members:object[], evidence:object, fingerprint:string, conflicted?:boolean}
 *   | {ok:false, reason:string, members:object[], evidence:object}>}
 */
export async function forecastQuestion(q, { inference, research, config = {}, asOf = new Date().toISOString(), log = () => {}, unlessFingerprint = null }) {
  const cfg = { ...DEFAULT_BOT_CONFIG, ...config, calibration: { ...DEFAULT_BOT_CONFIG.calibration, ...(config.calibration ?? {}) }, optionCalibration: { ...DEFAULT_BOT_CONFIG.optionCalibration, ...(config.optionCalibration ?? {}) } };
  const evidence = await research(q, { asOf });
  const fingerprint = evidence.items.slice(0, 10).map((i) => i.title.slice(0, 40)).join("|");
  if (unlessFingerprint !== null && fingerprint === unlessFingerprint) return { ok: true, unchanged: true, members: [], evidence, fingerprint };
  const prompt = buildPrompt(q, evidence.text, asOf);
  const jobs = [];
  for (const member of inference.members) for (let s = 0; s < cfg.samplesPerMember; s += 1) jobs.push({ member, s });
  const settled = await Promise.allSettled(jobs.map(({ member }) => inference.ask(member, { system: SYSTEM, user: prompt, temperature: cfg.temperature })));
  const results = [];
  const failures = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status !== "fulfilled") { failures.push({ member: jobs[i].member.id, error: String(r.reason?.message ?? r.reason).slice(0, 200) }); continue; }
    const parsed = parseMember(q, r.value.text);
    await inference.judge?.(r.value.lot, Boolean(parsed), parsed ? "forecast JSON parsed for the question type" : "delivery was not usable forecast JSON");
    if (!parsed) { failures.push({ member: jobs[i].member.id, error: "unparseable" }); continue; }
    const summary = q.type === "binary" ? `${(parsed.probability * 100).toFixed(1)}%` : q.type === "multiple_choice" ? Object.entries(parsed.vector).map(([k, v]) => `${first(k, 20)} ${Math.round(v * 100)}%`).join(", ") : parsed.percentiles.map((p) => `p${Math.round(p.percentile * 100)}=${q.type === "date" ? new Date(p.value * 1000).toISOString().slice(0, 10) : fmt(p.value)}`).join(" ");
    results.push({ meta: r.value.meta, parsed, summary });
  }
  const families = new Set(results.map((r) => r.meta.family));
  const memberRows = results.map((r) => ({ ...r.meta, summary: r.summary })).concat(failures.map((f) => ({ ...f, failed: true })));
  if (results.length < cfg.minMembers || families.size < cfg.minMembers) {
    return { ok: false, reason: `only ${results.length} usable members from ${families.size} families (need ${cfg.minMembers}); failures: ${JSON.stringify(failures)}`, members: memberRows, evidence, fingerprint };
  }

  let payload, summary, probability, conflicted;
  if (q.type === "binary") {
    const ests = results.map((r) => ({ probability: r.parsed.probability, confidence: r.parsed.confidence, source: r.meta.member }));
    const fused = fuseEvidenceToForecast(ests);
    conflicted = Boolean(fused.conflicted);
    const pooled = poolProbabilities(ests.map((e) => e.probability), { method: cfg.pool });
    probability = clamp(calibrateProbability(pooled, cfg.calibration), 0.001, 0.999);
    probability = Math.round(probability * 1e4) / 1e4;
    payload = { probability_yes: probability };
    summary = `${(probability * 100).toFixed(1)}% YES (pooled ${(pooled * 100).toFixed(1)}%, linear-mean ${(fused.probability * 100).toFixed(1)}%, extremize x${cfg.calibration.platt ? "platt" : cfg.calibration.extremize}, bounds ${cfg.calibration.floor}-${cfg.calibration.cap}${conflicted ? "; members disagree on side" : ""})`;
  } else if (q.type === "multiple_choice") {
    const vec = calibrateOptionVector(results.map((r) => r.parsed.vector), q.options, cfg.optionCalibration);
    payload = { probability_yes_per_category: vec };
    summary = Object.entries(vec).map(([k, v]) => `${first(k, 24)} ${(v * 100).toFixed(1)}%`).join(", ");
  } else {
    const cdf = aggregatePercentileSets(results.map((r) => r.parsed.percentiles), q);
    payload = { continuous_cdf: cdf };
    const at = (x) => { const v = cdfQuantile(cdf, x, q.scaling); return q.type === "date" ? new Date(v * 1000).toISOString().slice(0, 10) : fmt(v); };
    summary = `Vincentized CDF: p10=${at(0.1)} p50=${at(0.5)} p90=${at(0.9)}`;
  }
  assertPayloadFitsQuestion(q, payload);
  const comment = composeComment(q, { evidence, results, summary });
  log(`forecast ${q.questionId}: ${summary}`);
  return { ok: true, payload, comment, summary, probability, conflicted, members: memberRows, evidence, fingerprint };
}

export { cdfFromPercentiles, locationToValue };
