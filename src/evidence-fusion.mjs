/**
 * Fuses several forecasting evidence estimates using the real
 * @lenticule-science/metrologic/bilattice `aggregate` (joinKnowledge)
 * operation for the qualitative support/refutation charge, and an
 * ordinary confidence-weighted mean for the probability point-estimate --
 * see fuseEvidenceToForecast for why those two steps are kept honestly
 * separate rather than one dressed up as the other.
 */

import { aggregate, isTop } from "@lenticule-science/metrologic/bilattice";

/** @typedef {{probability: number, confidence: number, source: string}} EvidenceEstimate One source's stated probability estimate (in [0,1]) and its self-reported confidence (in [0,1]). */

const SUPPORT_THRESHOLD = 0.5;
const REFUTATION_THRESHOLD = 0.5;

function requireUnitInterval(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`evidence-fusion: ${label} must be a finite number in [0,1], got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateEstimate(estimate, index = 0) {
  if (typeof estimate !== "object" || estimate === null) throw new TypeError(`evidence-fusion: evidenceEstimates[${index}] must be an object`);
  requireUnitInterval(estimate.probability, `evidenceEstimates[${index}].probability`);
  requireUnitInterval(estimate.confidence, `evidenceEstimates[${index}].confidence`);
  if (typeof estimate.source !== "string" || estimate.source.length === 0) {
    throw new TypeError(`evidence-fusion: evidenceEstimates[${index}].source must be a non-empty string`);
  }
  return estimate;
}

/**
 * Encodes one evidence estimate as a metrologic bilattice Charge. THIS IS
 * OUR ENCODING CHOICE, not metrologic's: a probability strictly above 0.5
 * asserts the positive (support) side; strictly below 0.5 asserts the
 * negative (refutation) side; exactly 0.5 asserts neither (the FOUR value
 * "absurd" -- no witness on either side). The estimate itself becomes a
 * witness object placed in the evidence array on whichever side(s) it
 * asserts, so nothing is lost when charges are later joined.
 * @param {EvidenceEstimate} estimate
 * @returns {{value: [boolean, boolean], evidence: [unknown[], unknown[]]}} a metrologic bilattice Charge.
 */
export function chargeFromEvidenceEstimate(estimate) {
  validateEstimate(estimate);
  const { probability, confidence, source } = estimate;
  const witness = Object.freeze({ source, probability, confidence });
  const supports = probability > SUPPORT_THRESHOLD;
  const refutes = probability < REFUTATION_THRESHOLD;
  return { value: [supports, refutes], evidence: [supports ? [witness] : [], refutes ? [witness] : []] };
}

/**
 * Fuses several evidence estimates for one forecasting question into a
 * single probability point-estimate and one bilattice-typed support/
 * refutation charge. Two genuinely different operations happen here, kept
 * separate rather than one pretending to be the other: (1) the
 * probability POINT-ESTIMATE is a confidence-weighted mean of the
 * individual probabilities -- ordinary numeric aggregation, not
 * metrologic's job; (2) the qualitative CHARGE is the real metrologic
 * bilattice fusion (`aggregate`, i.e. joinKnowledge from
 * @lenticule-science/metrologic/bilattice): each estimate's charge (see
 * {@link chargeFromEvidenceEstimate}) is joined pairwise, so the fused
 * charge's value bits are TRUE on a side iff at least one source asserted
 * that side, and its evidence arrays lose no witness. A fused charge
 * valued top (`isTop`, i.e. "told both" in the knowledge order) means the
 * evidence base is in genuine CONFLICT -- some sources support, some
 * refute -- and the probability mean should be read with that in mind
 * rather than as a settled consensus.
 * @param {EvidenceEstimate[]} evidenceEstimates
 * @returns {{probability: number, charge: {value: [boolean, boolean], evidence: [unknown[], unknown[]]}, conflicted: boolean}}
 * @throws {TypeError} when evidenceEstimates is not a non-empty array of valid estimates.
 */
export function fuseEvidenceToForecast(evidenceEstimates) {
  if (!Array.isArray(evidenceEstimates) || evidenceEstimates.length === 0) {
    throw new TypeError("evidence-fusion: fuseEvidenceToForecast requires a non-empty array of evidence estimates");
  }
  evidenceEstimates.forEach(validateEstimate);
  const charges = evidenceEstimates.map(chargeFromEvidenceEstimate);
  const fusedCharge = charges.reduce((left, right) => aggregate({ left, right }));
  const totalConfidence = evidenceEstimates.reduce((sum, estimate) => sum + estimate.confidence, 0);
  const probability = totalConfidence > 0
    ? evidenceEstimates.reduce((sum, estimate) => sum + estimate.probability * estimate.confidence, 0) / totalConfidence
    : evidenceEstimates.reduce((sum, estimate) => sum + estimate.probability, 0) / evidenceEstimates.length;
  return { probability, charge: fusedCharge, conflicted: isTop(fusedCharge) };
}
