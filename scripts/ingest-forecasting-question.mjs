#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { normalizeQuestion } from "../src/forecasting.mjs";
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";

/**
 * Reads and validates a forecasting question definition from a JSON file.
 * @param {string} path - filesystem path to a question JSON file.
 * @returns {Readonly<import("../src/forecasting.mjs").ForecastingQuestion>}
 * @throws {Error} when the file is missing or not valid JSON.
 * @throws {TypeError} when the parsed question fails normalizeQuestion validation.
 */
export function ingestForecastingQuestionFromFile(path) {
  const resolvedPath = resolveFilepath([path]);
  let raw;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`ingest-forecasting-question: could not read ${resolvedPath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`ingest-forecasting-question: ${resolvedPath} is not valid JSON: ${error.message}`);
  }
  return normalizeQuestion(parsed);
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: ingest-forecasting-question.mjs <question.json>\n");
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(ingestForecastingQuestionFromFile(path), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
