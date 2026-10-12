#!/usr/bin/env node
// The section's daily cycle: resolve-set-of-forecast-questions ->
// score-forecast (idempotent, over newly resolved rows) ->
// derive-calibration-record (per reference class, over full history) ->
// the store. Composes the section's own scripts/src;
// see the exported function's JSDoc for the full contract.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { each, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { resolve } from "node:path";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { resolveSetOfForecastQuestions } from "../scripts/resolve-set-of-forecast-questions.mjs";
import { scoreForecast, CALIBRATION_TYPE } from "../scripts/score-forecast.mjs";
import { deriveCalibrationRecord } from "../scripts/derive-calibration-record.mjs";
import { FORECAST_TYPE, NODE_ROOT } from "../scripts/record-forecast.mjs";
import { brierScore, DATA_ROOT_ENV_VAR } from "../src/forecasting.mjs";

const QUESTIONS_DIR = new URL("../content/questions/", import.meta.url);

/** Kalshi weather series this cycle knows how to route (matches the brief's cohort; KXDENHIGH in content/config/weather-markets.json is not yet part of it). */
export const KNOWN_KALSHI_SERIES = ["KXHIGHCHI", "KXHIGHNY", "KXHIGHTHOU"];
/** The store type this cycle's own run receipts are written under. */
export const CYCLE_TYPE = "forecasting-cycle";
/** Market-implied evidence-citation source tag (mirrors forecast-weather-markets-cli.mjs's MARKET_EVIDENCE_SOURCE) used to classify a recorded forecast row as "market"-kind rather than "house"-kind. */
export const MARKET_EVIDENCE_SOURCE = "kalshi-market-implied";

const rootOf = (dataRoot) => resolve(dataRoot ?? NODE_ROOT);
/** The records of a store type as `{id, record}`: `id` is the address that holds the record. */
const rowsOf = (dataRoot, type) => [...each(rootOf(dataRoot), type)].map(({ address, record }) => ({ id: address, record }));

/**
 * Reads every static question definition file under content/questions/
 * (the ten Indian Country questions plus the demo question), raw JSON
 * (not normalizeQuestion, which drops the resolutionParameters field
 * three of them now carry).
 * @returns {object[]}
 */
export function readStaticQuestions() {
  const dir = fileURLToPath(QUESTIONS_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, QUESTIONS_DIR), "utf8")));
}

/**
 * Discovers every Kalshi-ticker-shaped question id recorded in the
 * forecast journal but not already covered by a static question file,
 * and routes each to its sourcePlatform by the series prefix its id
 * carries (the id's first hyphen-delimited segment is always the
 * lowercased series ticker unchanged, since Kalshi series tickers
 * contain no characters questionIdFromTicker would collapse).
 * @param {string} [dataRoot]
 * @param {Set<string>} staticIds
 * @returns {{id: string, sourcePlatform: string}[]}
 */
export function discoverKalshiQuestions(dataRoot, staticIds) {
  const rows = rowsOf(dataRoot, FORECAST_TYPE);
  const ids = new Set(rows.map((row) => row.record.questionId));
  const questions = [];
  for (const id of ids) {
    if (staticIds.has(id)) continue;
    const prefix = id.split("-")[0].toUpperCase();
    questions.push({ id, sourcePlatform: KNOWN_KALSHI_SERIES.includes(prefix) ? `kalshi.weather.${prefix}` : "unknown" });
  }
  return questions;
}

/**
 * Runs one full forecasting daily cycle: resolves every known question
 * (static Indian Country/demo questions plus every Kalshi-ticker id the
 * forecast journal has seen) against its machine-readable source,
 * idempotently scores any newly resolved forecast row (a forecastId
 * already carrying a calibration record is never re-scored), derives one
 * calibration record per reference class over the full resolved history,
 * and journals the whole cycle's run receipt.
 * @param {{dataRoot?: string, now?: string, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{runAt: string, questionCount: number, resolutions: object[], newlyScoredCount: number, calibrationRecords: object[], cycleReceipt: object}>}
 */
export async function runForecastingDailyCycle(options = {}) {
  const runAt = options.now ?? new Date().toISOString();
  const { dataRoot } = options;

  const staticQuestions = readStaticQuestions();
  const staticIds = new Set(staticQuestions.map((question) => question.id));
  const questions = [...staticQuestions, ...discoverKalshiQuestions(dataRoot, staticIds)];
  const questionById = new Map(questions.map((question) => [question.id, question]));

  const resolutions = await resolveSetOfForecastQuestions({ questions, now: runAt }, { fetchImpl: options.fetchImpl });

  const forecastRows = rowsOf(dataRoot, FORECAST_TYPE);
  const alreadyScoredForecastIds = new Set(
    rowsOf(dataRoot, CALIBRATION_TYPE).map((row) => row.record?.forecastId).filter((id) => typeof id === "string"),
  );

  const scoredForecasts = [];
  let newlyScoredCount = 0;
  for (const resolution of resolutions) {
    if (resolution.type !== "Resolved") continue;
    const question = questionById.get(resolution.questionId);
    const rows = forecastRows.filter((row) => row.record.questionId === resolution.questionId);
    for (const row of rows) {
      const kind = row.record.evidenceCitations?.[0]?.source === MARKET_EVIDENCE_SOURCE ? "market" : "house";
      scoredForecasts.push({
        referenceClass: question.sourcePlatform,
        questionId: resolution.questionId,
        kind,
        probability: row.record.probability,
        outcome: resolution.outcome,
        brierScore: brierScore(row.record.probability, resolution.outcome),
      });
      if (!alreadyScoredForecastIds.has(row.id)) {
        scoreForecast({ forecastId: row.id, outcome: resolution.outcome, kind, referenceClass: question.sourcePlatform }, { dataRoot, recordedAt: runAt });
        newlyScoredCount += 1;
      }
    }
  }

  const referenceClasses = [...new Set(questions.map((question) => question.sourcePlatform))];
  const calibrationRecords = deriveCalibrationRecord({ scoredForecasts, referenceClasses, derivedAt: runAt });

  const cycleReceipt = { id: put(rootOf(dataRoot), CYCLE_TYPE, { runAt, questionCount: questions.length, resolutions, newlyScoredCount, calibrationRecords }) };

  return { runAt, questionCount: questions.length, resolutions, newlyScoredCount, calibrationRecords, cycleReceipt };
}

runMain(({ argv }) => {
  const dataRootFlagAt = argv.indexOf("--data-root");
  // DATA_ROOT_ENV_VAR lets a deployed unit wire a state directory outside
  // its release tree (release-package-on-host.mjs's --environment-file)
  // without hardcoding the path into ExecStart; --data-root still wins
  // when both are given. Shared with forecast-weather-markets-cli.mjs's
  // run/score commands so one environment file covers every unit.
  const dataRoot = dataRootFlagAt === -1 ? process.env[DATA_ROOT_ENV_VAR] : argv[dataRootFlagAt + 1];
  return runForecastingDailyCycle({ dataRoot });
}, {
  moduleUrl: import.meta.url,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
