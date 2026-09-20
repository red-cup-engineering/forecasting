#!/usr/bin/env node
import { ingestForecastingQuestionFromFile } from "../scripts/ingest-forecasting-question.mjs";
import { gatherQuestionEvidence } from "../scripts/gather-question-evidence.mjs";
import { fuseForecast } from "../scripts/fuse-forecast.mjs";
import { recordForecast } from "../scripts/record-forecast.mjs";
import { scoreForecast } from "../scripts/score-forecast.mjs";
import { runMain } from "@red-cup-engineering/javascript-file-main-guard-service";

/**
 * Composes the full forecasting pipeline: ingest a question, gather one
 * evidence estimate through the free-first inference dispatch, fuse it
 * into a forecast, and record the forecast via the semantic record
 * journal. No capital is placed at risk anywhere in this pipeline --
 * entry cost is compute/time paid through the existing free-inference
 * rails, never a market position.
 * @param {string} questionPath - path to a question JSON file.
 * @param {{catalogPath?: string, request?: typeof fetch, dataRoot?: string}} [options]
 * @returns {Promise<{question: object, evidence: object, forecast: object, fusion: object, receipt: object}>}
 */
export async function runForecastingPipeline(questionPath, options = {}) {
  const question = ingestForecastingQuestionFromFile(questionPath);
  const evidence = await gatherQuestionEvidence(`${question.title} — ${question.resolutionCriteria}`, {
    catalogPath: options.catalogPath,
    request: options.request,
  });
  const { forecast, fusion } = fuseForecast({ questionId: question.id, evidenceEstimates: [evidence] });
  const receipt = recordForecast(forecast, { dataRoot: options.dataRoot });
  return { question, evidence, forecast, fusion, receipt };
}

/**
 * Composes the separate scoring pipeline: scores a previously recorded
 * forecast against a resolved outcome and records the calibration entry.
 * @param {string} forecastId
 * @param {0|1} outcome
 * @param {{dataRoot?: string}} [options]
 * @returns {object} the calibration journal record receipt.
 */
export function runForecastingScoring(forecastId, outcome, options = {}) {
  return scoreForecast({ forecastId, outcome }, options);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "run") {
    const [questionPath, ...flags] = rest;
    const catalogFlagAt = flags.indexOf("--catalog");
    const catalogPath = catalogFlagAt === -1 ? undefined : flags[catalogFlagAt + 1];
    return runForecastingPipeline(questionPath, { catalogPath });
  }
  if (command === "score") {
    const [forecastId, outcomeArg] = rest;
    return runForecastingScoring(forecastId, Number(outcomeArg));
  }
  throw new Error('usage: forecasting-cli.mjs run <question.json> [--catalog <path>] | forecasting-cli.mjs score <forecastId> <outcome 0|1>');
}

runMain(({ argv }) => main(argv), {
  moduleUrl: import.meta.url,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
