#!/usr/bin/env node
/**
 * One actually executed public environmental data product, not a fixture or
 * seller. Original NOAA/NWS reads and NI identities stay with their existing
 * Forecasting providers; GitHub Actions owns this edition's scheduled run.
 * This is OBSERVATION only: not a probability forecast, navigational advice,
 * x402 settlement, operational safety certification, or on-chain trade.
 */
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readNoaaCoopsWaterLevel } from "../src/coops-water-level.mjs";
import { readNwsMetarSnapshot } from "../src/station-observations.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = resolve(ROOT, "data/records/great-lakes-duluth-observations");
const OUT = resolve(DIRECTORY, "latest.json");
const HISTORY = resolve(DIRECTORY, "history.jsonl");
const MAX_HISTORY = 112;
const SIX_HOURS = 6 * 3600_000;
const ONE_HOUR = 3600_000;

function sourceState(settled) {
  if (settled.status === "fulfilled") return { state: "received", result: settled.value };
  return {
    state: "unavailable",
    reason: settled.reason instanceof Error ? settled.reason.message.slice(0, 300) : "unknown-source-refusal",
  };
}
function summarizeWater(read, at) {
  const xs = read.observations;
  const latest = xs.at(-1);
  const clock = Date.parse(latest.observedAt);
  const recent = xs.filter(x => Date.parse(x.observedAt) >= clock - SIX_HOURS);
  const priorHour = [...xs].reverse().find(x =>
    Date.parse(x.observedAt) <= clock - ONE_HOUR &&
    Date.parse(x.observedAt) >= clock - ONE_HOUR - 20 * 60_000);
  const ageSeconds = (Date.parse(at) - clock) / 1000;
  return {
    station: read.station,
    verticalDatum: read.datum,
    unit: read.unit, timeZone: read.timeZone,
    receivedAt: read.source.receivedAt,
    observedAt: latest.observedAt,
    ageSeconds,
    freshness: ageSeconds >= 0 && ageSeconds <= 3600 ? "recent-observation" : "stale-or-future-observation",
    measurementState: read.measurementState,
    sourceCoverage: read.coverage ?? { finiteSamples: xs.length, missingSamples: null,
      meaning: "Older source reader has not reported data gaps" },
    sampleCount: xs.length,
    latest: {
      heightMeters: latest.heightMeters,
      ...(latest.quality === undefined ? {} : { sourceQualityCode: latest.quality }),
      ...(latest.flags === undefined ? {} : { sourceFlags: latest.flags }),
      ...(latest.sigma === undefined ? {} : { sourceSigma: latest.sigma }),
    },
    sixHourRangeMeters: recent.length
      ? { lower: Math.min(...recent.map(x => x.heightMeters)),
          upper: Math.max(...recent.map(x => x.heightMeters)), observations: recent.length }
      : null,
    oneHourChangeMeters: priorHour ? latest.heightMeters - priorHour.heightMeters : null,
    source: {
      url: read.source.url, ni: read.source.identity, originalBytes: read.source.bytes,
      provider: read.source.attribution, rights: read.source.rights,
      stationMetadata: read.source.sourceMetadata,
    },
  };
}
function summarizeMetar(read, at) {
  const ageSeconds = (Date.parse(at) - Date.parse(read.observation.at)) / 1000;
  return {
    station: "KDLH",
    observedAt: read.observation.at,
    ageSeconds,
    freshness: ageSeconds >= 0 && ageSeconds <= 7200 ? "recent-observation" : "stale-or-future-observation",
    observation: read.observation,
    source: {
      url: read.source.url, ni: read.source.identity, originalBytes: read.source.bytes,
      receivedAt: read.source.receivedAt, issuedAt: read.source.issuedAt,
      freshness: read.source.freshness, rights: read.source.rights,
    },
  };
}
async function readPrior() {
  try { return JSON.parse(await readFile(OUT, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
async function readHistory() {
  try {
    const text = await readFile(HISTORY, "utf8");
    return text.split("\n").filter(Boolean).map(row => JSON.parse(row)).slice(-MAX_HISTORY + 1);
  } catch (e) { if (e.code === "ENOENT") return []; throw e; }
}
async function atomicText(path, contents) {
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o644 });
  await rename(temporary, path);
}
function sampleSummary(rows, kind) {
  const seen = rows.map(row => row.sources[kind]);
  const good = seen.filter(x => x?.state === "received" && x.fresh === true);
  return {
    observedRuns: seen.length, freshAcceptedRuns: good.length,
    observedFreshFraction: seen.length ? good.length / seen.length : null,
    meaning: "Empirical publication-loop reliability for this specific original NOAA source; no provider SLA or forecasting accuracy",
  };
}
export async function publishGreatLakesObservation({ now = () => new Date().toISOString() } = {}) {
  const clock = now();
  if (typeof clock !== "string" || new Date(clock).toISOString() !== clock)
    throw new TypeError("publication needs a canonical actual UTC clock");
  const date = clock.slice(0, 10).replaceAll("-", "");
  const results = await Promise.allSettled([
    readNoaaCoopsWaterLevel({ station: "9099064", date, datum: "IGLD" }),
    readNwsMetarSnapshot({ station: "KDLH" }),
  ]);
  const water = sourceState(results[0]), air = sourceState(results[1]);
  // Do not overwrite a useful public artifact when both official sources fail.
  if (water.state !== "received" && air.state !== "received")
    throw new Error("Neither original NOAA water level nor NWS METAR is available; public edition unchanged");

  const waterLevel = water.state === "received" ? summarizeWater(water.result, clock) : null;
  const metar = air.state === "received" ? summarizeMetar(air.result, clock) : null;
  const prior = await readPrior();
  const history = await readHistory();
  const sourceStates = {
    waterLevel: { state: water.state, fresh: waterLevel?.freshness === "recent-observation",
      ...(waterLevel ? {ni:waterLevel.source.ni, observedAt:waterLevel.observedAt} : {reason:water.reason}) },
    metar: { state: air.state, fresh: metar?.freshness === "recent-observation",
      ...(metar ? {ni:metar.source.ni, observedAt:metar.observedAt} : {reason:air.reason}) },
  };
  const entry = {at: clock, sources: sourceStates};
  const updated = [...history, entry].slice(-MAX_HISTORY);
  const edition = {
    kind: "561-group.great-lakes-source-observation/v1",
    generatedAt: clock,
    subject: "Duluth, Minnesota / western Lake Superior",
    measurementContract: {
      oceanicAndGreatLakesSource: "NOAA CO-OPS station 9099064",
      airStationSource: "NWS/NOAA METAR KDLH",
      verticalDatum: "IGLD",
      waterUnit: "metre", temporalReference: "UTC",
      not: ["prediction", "watercraft navigation advice", "CVE service", "trading signal", "independently accepted paid service"],
    },
    supply: sourceStates,
    observations: {waterLevel, metar},
    continuity: {
      previousEditionAt: prior?.generatedAt ?? null,
      waterLevelSourceChanged: waterLevel && prior?.observations?.waterLevel
        ? waterLevel.source.ni !== prior.observations.waterLevel.source.ni : null,
      metarSourceChanged: metar && prior?.observations?.metar
        ? metar.source.ni !== prior.observations.metar.source.ni : null,
    },
    observedProviderReliability: {
      waterLevel: sampleSummary(updated, "waterLevel"), metar: sampleSummary(updated, "metar"),
      windowRuns: updated.length,
    },
    rights: "Source data attributed to NOAA/NWS; no endorsement, safety certification or exclusivity is asserted.",
    economics: {
      newCashExpenseAuthorizedUSD: "0",
      separateMarginalComputeCost: "unmeasured",
      merchantSettlement: "not-observed-by-this-publication",
      independentBuyerDelivery: "not-observed-by-this-publication",
    },
  };
  await mkdir(DIRECTORY, {recursive:true});
  await atomicText(HISTORY, updated.map(row=>JSON.stringify(row)).join("\n")+"\n");
  await atomicText(OUT, JSON.stringify(edition,null,2)+"\n");
  return {path:OUT,generatedAt:clock,water:sourceStates.waterLevel,air:sourceStates.metar,
    historicalRuns:updated.length};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const response = await publishGreatLakesObservation();
  process.stdout.write(JSON.stringify(response) + "\n");
}
