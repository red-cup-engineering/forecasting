#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

/** This package's own root, the default store custody root (records land at data/records/, per house data-custody law). */
export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The store type forecast records are written and read under. */
export const FORECAST_TYPE = "forecast";

/**
 * Records one canonical forecast (from fuse-forecast.mjs) into this
 * section's store; a forecast that carries no `timestamp` is given the time it is recorded at.
 * @param {import("../src/forecasting.mjs").ForecastRecord} forecast
 * @param {{dataRoot?: string, recordedAt?: string}} [options]
 * @returns {{id: string}} the address that holds the forecast.
 * @throws {TypeError} when forecast lacks a questionId.
 */
export function recordForecast(forecast, options = {}) {
  if (!forecast || typeof forecast.questionId !== "string" || forecast.questionId.length === 0) {
    throw new TypeError("record-forecast: forecast requires a non-empty questionId");
  }
  const dataRoot = resolve(options.dataRoot ?? NODE_ROOT);
  const record = forecast.timestamp === undefined ? { ...forecast, timestamp: options.recordedAt ?? new Date().toISOString() } : forecast;
  return { id: put(dataRoot, FORECAST_TYPE, record) };
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: record-forecast.mjs <forecast.json>\n");
    process.exitCode = 2;
  } else {
    const forecast = JSON.parse(readFileSync(resolve(path), "utf8"));
    process.stdout.write(`${JSON.stringify(recordForecast(forecast), null, 2)}\n`);
  }
}
