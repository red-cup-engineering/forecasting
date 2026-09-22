import assert from "node:assert/strict";
import test from "node:test";
import { isTop, chargeValue } from "@lenticule-science/metrologic/articulation/predicating/positing/bilattice-charge";
import { chargeFromEvidenceEstimate, fuseEvidenceToForecast } from "../src/evidence-fusion.mjs";

test("chargeFromEvidenceEstimate reads a supportive estimate as the positive-only FOUR value", () => {
  const charge = chargeFromEvidenceEstimate({ probability: 0.8, confidence: 0.5, source: "groq" });
  assert.deepEqual(charge.value, chargeValue("potential").coordinates);
  assert.equal(charge.evidence[0].length, 1);
  assert.equal(charge.evidence[1].length, 0);
  assert.equal(charge.evidence[0][0].value.source, "groq");
});

test("chargeFromEvidenceEstimate reads a refuting estimate as the negative-only FOUR value", () => {
  const charge = chargeFromEvidenceEstimate({ probability: 0.2, confidence: 0.5, source: "gemini-direct" });
  assert.deepEqual(charge.value, chargeValue("active").coordinates);
  assert.equal(charge.evidence[0].length, 0);
  assert.equal(charge.evidence[1].length, 1);
});

test("chargeFromEvidenceEstimate reads an exactly-0.5 estimate as absurd (no assertion either side)", () => {
  const charge = chargeFromEvidenceEstimate({ probability: 0.5, confidence: 0.9, source: "ollama-local" });
  assert.deepEqual(charge.value, chargeValue("absurd").coordinates);
});

test("chargeFromEvidenceEstimate rejects an out-of-range probability", () => {
  assert.throws(() => chargeFromEvidenceEstimate({ probability: 1.5, confidence: 0.5, source: "x" }), /must be a finite number in \[0,1\]/u);
});

test("fuseEvidenceToForecast rejects an empty evidence array", () => {
  assert.throws(() => fuseEvidenceToForecast([]), /non-empty array/u);
});

test("fuseEvidenceToForecast on two agreeing sources: confidence-weighted mean and no conflict", () => {
  const estimates = [
    { probability: 0.7, confidence: 0.8, source: "groq" },
    { probability: 0.9, confidence: 0.4, source: "gemini-direct" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  const expectedMean = (0.7 * 0.8 + 0.9 * 0.4) / (0.8 + 0.4);
  assert.ok(Math.abs(fusion.probability - expectedMean) < 1e-12);
  assert.deepEqual(fusion.charge.value, chargeValue("potential").coordinates);
  assert.equal(fusion.conflicted, false);
  assert.equal(isTop(fusion.charge), false);
  assert.equal(fusion.charge.evidence[0].length, 2);
  assert.equal(fusion.charge.evidence[1].length, 0);
});

test("fuseEvidenceToForecast on disagreeing sources: charge settles at top (told-both) and conflicted is true", () => {
  const estimates = [
    { probability: 0.8, confidence: 0.5, source: "groq" },
    { probability: 0.2, confidence: 0.5, source: "openrouter" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  assert.equal(fusion.probability, 0.5);
  assert.deepEqual(fusion.charge.value, chargeValue("stable").coordinates);
  assert.equal(fusion.conflicted, true);
  assert.equal(isTop(fusion.charge), true);
  assert.equal(fusion.charge.evidence[0].length, 1);
  assert.equal(fusion.charge.evidence[1].length, 1);
});

test("fuseEvidenceToForecast falls back to a plain mean when every confidence is 0", () => {
  const estimates = [
    { probability: 0.3, confidence: 0, source: "a" },
    { probability: 0.7, confidence: 0, source: "b" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  assert.equal(fusion.probability, 0.5);
});

test("fuseEvidenceToForecast rejects an estimate with an out-of-range confidence", () => {
  assert.throws(() => fuseEvidenceToForecast([{ probability: 0.5, confidence: 2, source: "a" }]), /confidence.*must be a finite number in \[0,1\]/u);
});
