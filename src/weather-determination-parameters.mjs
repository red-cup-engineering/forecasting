/**
 * The parameters the determination models share, each with what it is and where it comes from. A parameter's kind says why it has the
 * value it has:
 *   contract     a fact of the contract or the instrument (a tick, a deadline, a gauge's resolution)
 *   convention   a statistical convention, with its source, and the sensitivity of the results to it is reported beside the results
 *   measured     read off a recorded dataset; `dataset` and `derivation` name the data and the function that produced it
 * The models take their numbers from here; test/determination-parameters.test.mjs fails on a numeric literal in them that is not here,
 * a unit, or an index.
 */
export const parameter = (value, kind, provenance, extra = {}) => Object.freeze({ value, kind, provenance, ...extra });

export const SHARED = Object.freeze({
  confidence: parameter(0.05, 'convention', 'one-sided 95%: Clopper and Pearson 1934; Efron and Tibshirani 1993 section 13. Results are reported at 0.01 and 0.10 beside it'),
  resamples: parameter(200, 'convention', 'block bootstrap replicates; the percentile interval of a tail quantile is stable to a few percent at 200 (Efron and Tibshirani 1993 section 13.3)'),
  priceTick: parameter(0.01, 'contract', 'series price_ranges step 0.0100 (GET /markets/KXTEMPMIAH-26OCT1713-T83.99: price_level_structure linear_cent)'),
});
