import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPayloadFitsQuestion, createMetaculusClient, flattenPost, MetaculusTokenAbsentError } from "../src/metaculus-client.mjs";
import { aggregatePercentileSets, cdfFromPercentiles, cdfQuantile } from "../src/metaculus-cdf.mjs";
import { calibrateOptionVector, calibrateProbability, fitPlatt, poolProbabilities } from "../src/probability-calibration.mjs";
import { forecastQuestion } from "../src/forecast-bot.mjs";
import { decide, loadConfig, openState, runTick } from "../scripts/metaculus-tick.mjs";

const post = (id, question, extra = {}) => ({ id, title: `Post ${id}`, projects: { tournament: [{ slug: "fall-futureeval-2026" }] }, question: { id: id * 10, status: "open", scheduled_close_time: new Date(Date.now() + 2 * 3600e3).toISOString(), ...question }, ...extra });
const numericQ = post(7, { type: "numeric", title: "How many?", unit: "widgets", open_lower_bound: false, open_upper_bound: true, scaling: { range_min: 0, range_max: 1000, zero_point: null, inbound_outcome_count: 200 } });
const logQ = post(8, { type: "numeric", title: "Price?", open_lower_bound: true, open_upper_bound: true, scaling: { range_min: 10, range_max: 100000, zero_point: 0, inbound_outcome_count: 200 } });
const binQ = post(9, { type: "binary", title: "Will it rain?" });
const mcQ = post(10, { type: "multiple_choice", title: "Who wins?", options: ["A", "B", "C"] });

test("client refuses every call without a token, including reads", async () => {
  const client = createMetaculusClient({ token: "", fetchImpl: () => assert.fail("must not reach the network") });
  await assert.rejects(client.listOpenQuestions(33121), MetaculusTokenAbsentError);
  await assert.rejects(client.postForecast(flattenPost(binQ)[0], { probability_yes: 0.5 }), MetaculusTokenAbsentError);
});

test("client sends Token auth, honest user agent, and the forecast body shape", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ results: [binQ], next: null }), { status: 200 }); };
  const client = createMetaculusClient({ token: "t0k", fetchImpl, minIntervalMs: 0, sleep: async () => {} });
  const qs = await client.listOpenQuestions(33121);
  assert.equal(qs.length, 1);
  assert.equal(seen[0].init.headers.Authorization, "Token t0k");
  assert.match(seen[0].init.headers["User-Agent"], /561-group/);
  assert.match(seen[0].url, /tournaments=33121/);
  await client.postForecast(qs[0], { probability_yes: 0.31 });
  assert.deepEqual(JSON.parse(seen[1].init.body), [{ question: 90, source: "api", probability_yes: 0.31 }]);
  await assert.rejects(client.postForecast(qs[0], { probability_yes: 1.2 }), /0\.001/);
});

test("numeric CDF is valid for closed-lower/open-upper linear and open/open log questions", () => {
  for (const p of [numericQ, logQ]) {
    const q = flattenPost(p)[0];
    const vals = p === numericQ ? [100, 200, 300, 400, 550, 700] : [100, 300, 1000, 3000, 9000, 20000];
    const declared = [0.1, 0.2, 0.4, 0.6, 0.8, 0.9].map((percentile, i) => ({ percentile, value: vals[i] }));
    const cdf = cdfFromPercentiles(declared, q);
    assert.equal(cdf.length, 201);
    assert.doesNotThrow(() => assertPayloadFitsQuestion(q, { continuous_cdf: cdf }));
    const med = cdfQuantile(cdf, 0.5, q.scaling);
    assert.ok(med > vals[1] && med < vals[4], `median ${med}`);
  }
  const q = flattenPost(numericQ)[0];
  const set = (shift) => [0.1, 0.2, 0.4, 0.6, 0.8, 0.9].map((percentile, i) => ({ percentile, value: [100, 200, 300, 400, 550, 700][i] + shift }));
  assert.doesNotThrow(() => assertPayloadFitsQuestion(q, { continuous_cdf: aggregatePercentileSets([set(0), set(50), set(-30)], q) }));
});

test("calibration: pooling, last-step cap, Platt refuses tiny samples, options sum to 1", () => {
  assert.ok(Math.abs(poolProbabilities([0.2, 0.3, 0.4], { method: "median" }) - 0.3) < 1e-9);
  assert.equal(calibrateProbability(0.999, { cap: 0.97 }), 0.97);
  assert.ok(calibrateProbability(0.7, { extremize: 1.5 }) > 0.7);
  assert.equal(fitPlatt([{ probability: 0.5, outcome: 1 }]), null);
  const obs = Array.from({ length: 200 }, (_, i) => ({ probability: 0.2 + 0.6 * ((i % 10) / 9), outcome: (i % 10) / 9 > 0.5 ? 1 : 0 }));
  assert.ok(fitPlatt(obs).a > 1, "underconfident data should extremize");
  const v = calibrateOptionVector([{ A: 0.7, B: 0.3, C: 0 }, { A: 0.5, B: 0.4, C: 0.1 }], ["A", "B", "C"]);
  assert.ok(Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 1) < 1e-9 && v.C >= 0.009);
});

const stubInference = (probs) => ({
  members: probs.map((_, i) => ({ id: `m${i}`, family: `f${i}`, provider: `urn:p${i}` })),
  ask: async (member) => {
    const i = Number(member.id.slice(1));
    return { member, lot: {}, meta: { member: member.id, family: member.family, model: `model${i}`, provider: member.provider }, text: JSON.stringify(probs[i]) };
  },
});
const research = async () => ({ items: [{ title: "Headline A", source: "Wire", origin: "google-news", publishedAt: "2026-10-03T00:00:00Z" }], text: "- [2026-10-03] Headline A (Wire)", queries: ["q"] });

test("agent core: binary, numeric, multiple choice each yield a valid payload and a comment; fewer than 3 families refuse", async () => {
  const bin = await forecastQuestion(flattenPost(binQ)[0], { inference: stubInference([{ reasoning: "r", probability: 0.2 }, { reasoning: "r", probability: 0.3 }, { reasoning: "r", probability: 0.25 }]), research });
  assert.ok(bin.ok && bin.payload.probability_yes > 0.2 && bin.payload.probability_yes < 0.3 && /Members:/.test(bin.comment));
  const pct = { "10": 100, "20": 200, "40": 300, "60": 400, "80": 550, "90": 700 };
  const num = await forecastQuestion(flattenPost(numericQ)[0], { inference: stubInference([{ reasoning: "r", percentiles: pct }, { reasoning: "r", percentiles: pct }, { reasoning: "r", percentiles: pct }]), research });
  assert.ok(num.ok && num.payload.continuous_cdf.length === 201);
  const mc = await forecastQuestion(flattenPost(mcQ)[0], { inference: stubInference([{ probabilities: { A: 0.6, B: 0.3, C: 0.1 } }, { probabilities: { A: 0.5, B: 0.3, C: 0.2 } }, { probabilities: { A: 0.7, B: 0.2, C: 0.1 } }]), research });
  assert.ok(mc.ok && Math.abs(Object.values(mc.payload.probability_yes_per_category).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const two = await forecastQuestion(flattenPost(binQ)[0], { inference: stubInference([{ probability: 0.2 }, { probability: 0.3 }]), research });
  assert.equal(two.ok, false);
});

test("tick in dry-run writes would-submit payloads, never POSTs, and forecasts each question once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-tick-"));
  const state = openState(dir);
  const client = { postForecast: () => assert.fail("dry run must not POST"), postComment: () => assert.fail("dry run must not POST") };
  const questions = [binQ, mcQ].flatMap(flattenPost);
  const inference = stubInference([{ reasoning: "r", probability: 0.4, probabilities: { A: 0.5, B: 0.3, C: 0.2 } }, { reasoning: "r", probability: 0.45, probabilities: { A: 0.5, B: 0.3, C: 0.2 } }, { reasoning: "r", probability: 0.35, probabilities: { A: 0.5, B: 0.3, C: 0.2 } }]);
  const config = loadConfig();
  const first = await runTick({ client, questions, inference, research, config, state, live: false, log: () => {} });
  assert.equal(first.forecast, 2);
  assert.equal(readdirSync(join(dir, "would-submit")).length, 2);
  const second = await runTick({ client, questions, inference, research, config, state, live: false, log: () => {} });
  assert.equal(second.forecast, 0);
  assert.match(readFileSync(join(dir, "ledger.jsonl"), "utf8"), /"kind":"dry-run"/);
});

test("decide: new, skip closed, final window, recheck", () => {
  const tick = loadConfig().tick;
  const now = Date.now();
  const q = (mins) => ({ closeTime: new Date(now + mins * 60000).toISOString() });
  assert.equal(decide(q(120), null, now, tick).act, "new");
  assert.equal(decide(q(-5), null, now, tick).act, "skip");
  assert.equal(decide(q(3), null, now, tick).act, "skip");
  const st = (agoMin) => ({ forecasts: [{ at: new Date(now - agoMin * 60000).toISOString() }], finalDone: false });
  assert.equal(decide(q(20), st(10), now, tick).act, "final");
  assert.equal(decide(q(100), st(40), now, tick).act, "recheck");
  assert.equal(decide(q(100), st(5), now, tick).act, "skip");
});
