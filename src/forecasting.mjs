/**
 * Kalshi forecasting naming over the domain-neutral prediction engineering core. The records, scoring rules and calibration curve live in
 * @red-cup-engineering/prediction-engineering-services-section and are re-exported unchanged; only the ticker and series naming of this venue is here.
 */

import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

export { normalizeQuestion, createForecast, brierScore, logScore, calibrationBuckets } from "@red-cup-engineering/prediction-engineering-services-section/forecast";

/**
 * Normalizes a Kalshi bracket ticker (e.g. "KXHIGHNY-26SEP05-B85.5") into
 * this section's lowercase-hyphen ForecastingQuestion id. Moved here
 * 2026-09-05 from apps/forecast-weather-markets-cli.mjs (re-exported there
 * unchanged for its existing consumers) so scripts/resolve-set-of-forecast-questions.mjs
 * can share the same transform without a script importing an app (import
 * law: scripts import scripts and src, never apps).
 * @param {string} ticker
 * @returns {string}
 */
export function questionIdFromTicker(ticker) {
  // A bracket ticker like "KXHIGHNY-26SEP05-B85.5" carries a decimal strike;
  // this id must be lowercase-hyphen only, so any run of non [a-z0-9]
  // characters (the "." here) becomes one hyphen.
  return slugify(ticker);
}

/**
 * The calibration reference class for one Kalshi weather series. Moved
 * here 2026-09-05 alongside questionIdFromTicker (see that function's doc).
 * @param {string} seriesTicker
 * @returns {string}
 */
export function referenceClassFromSeries(seriesTicker) {
  return `kalshi.weather.${seriesTicker}`;
}

/**
 * The environment variable name every deployed unit of this section reads
 * its journal data root from (one state root shared by
 * forecast-weather-markets-cli.mjs's run/score commands and
 * forecasting-daily-cycle.mjs), so one release-package-on-host
 * environment file wires all of them consistently. Added 2026-09-05
 * (coordinator ruling: one state root).
 * @type {string}
 */
export const DATA_ROOT_ENV_VAR = "FORECASTING_DAILY_CYCLE_DATA_ROOT";
