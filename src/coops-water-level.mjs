/**
 * NOAA National Ocean Service CO-OPS one-day observed water levels.
 *
 * This is the data-producing, effectful edge of the already-owned forecasting
 * service; the immutable NI bytes and pure admission come from existing 561
 * HTTP, URI and JSON providers. It is not an x402 merchant, data-license
 * registry, reconciliation book or tide-prediction algorithm.
 *
 * Reference: https://api.tidesandcurrents.noaa.gov/api/prod/
 * Source rights: https://oceanservice.noaa.gov/disclaimer.html
 */
import { readBody } from "@red-cup-engineering/http-services-section/body/web";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { admitCanonicalJson, JSON_RESOURCE_ENVELOPE } from "@red-cup-engineering/json-services-section/canonical-json";

const COOPS_ORIGIN = "https://api.tidesandcurrents.noaa.gov";
const COOPS_PATH = "/api/prod/datagetter";
const MAX_SOURCE_BYTES = 131072;
// Great Lakes station datum is IGLD; a tidal MLLW interpretation at Duluth
// changes the physical quantity rather than merely its name.
const KNOWN_GREAT_LAKES_DATUM = Object.freeze({ "9099064": "IGLD" });
const OBSERVED_DATUMS = new Set(["MLLW", "IGLD"]);
const MAX_RESULT_BYTES = 262144;
const RESPONSE_ENVELOPE = Object.freeze({
  ...JSON_RESOURCE_ENVELOPE,
  maxSourceBytes: MAX_RESULT_BYTES,
  maxCanonicalBytes: MAX_RESULT_BYTES,
});

function calendarDate(yyyymmdd) {
  if (typeof yyyymmdd !== "string" || !/^[0-9]{8}$/u.test(yyyymmdd)) return null;
  const day = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(day) ? day : null;
}

/** Admit an explicit physical vertical datum where it matters. Legacy
 * coastal callers retain MLLW, while a known Great Lakes gauge cannot be
 * silently interpreted using a tidal datum. No right or observed data is
 * created by the caller's datum declaration; NOAA remains the source. */
export function admitNoaaCoopsWaterLevel(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request) ||
      Object.keys(request).some(key => !["station", "date", "datum"].includes(key)) ||
      !Object.hasOwn(request, "station") || !Object.hasOwn(request, "date") ||
      typeof request.station !== "string" || !/^[0-9]{7}$/u.test(request.station) ||
      calendarDate(request.date) === null ||
      (request.datum !== undefined && !OBSERVED_DATUMS.has(request.datum))) {
    throw new TypeError("CO-OPS water level needs a 7-digit station, UTC YYYYMMDD date, and optional admitted MLLW/IGLD datum");
  }
  const fixedDatum = KNOWN_GREAT_LAKES_DATUM[request.station];
  if (fixedDatum && request.datum !== fixedDatum)
    throw new TypeError(`Great Lakes station ${request.station} requires explicit ${fixedDatum} physical datum`);
  return Object.freeze({
    station: request.station, date: request.date,
    ...(request.datum === undefined ? {} : { datum: request.datum }),
  });
}

/** A day and vertical datum are in the SAME fixed unit and time coordinate. */
export function coopsWaterLevelUrl(request) {
  const { station, date, datum = "MLLW" } = admitNoaaCoopsWaterLevel(request);
  const url = new URL(COOPS_PATH, COOPS_ORIGIN);
  for (const [key, value] of [
    ["begin_date", date], ["end_date", date], ["station", station],
    ["product", "water_level"], ["datum", datum], ["time_zone", "gmt"],
    ["units", "metric"], ["format", "json"], ["application", "561Group"],
  ]) url.searchParams.set(key, value);
  return url.href;
}

function observationDate(value, targetDate) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d \d\d:\d\d$/u.test(value) ||
      !value.startsWith(targetDate + " ")) throw new TypeError("CO-OPS observation is outside requested UTC day");
  const iso = value.replace(" ", "T") + ":00.000Z";
  const epoch = Date.parse(iso);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== iso) {
    throw new TypeError("CO-OPS response carries an invalid UTC observation time");
  }
  return iso;
}

/**
 * A bounded NOAA observed-water-level snapshot, not a prediction or a guaranteed
 * verified observation. Keep NOAA's q/f/s quality readings and untouched source
 * response; never infer that provisional measurements are verified.
 */
export async function readNoaaCoopsWaterLevel(request, {
  fetchImpl = fetch, now = () => new Date().toISOString(),
} = {}) {
  const admitted = admitNoaaCoopsWaterLevel(request);
  const url = coopsWaterLevelUrl(admitted);
  const signal = AbortSignal.timeout(12000);
  const response = await fetchImpl(url, {
    method: "GET", headers: { accept: "application/json" },
    redirect: "error", signal,
  });
  if (!response.ok || response.redirected || (response.url && response.url !== url)) {
    await response.body?.cancel().catch(() => {});
    throw new Error("CO-OPS observed-water-level source refused or redirected");
  }
  const bytes = await readBody(
    { body: response.body, headers: response.headers, signal },
    { maxBytes: MAX_SOURCE_BYTES, decodeContentEncoding: false },
  );
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  let original;
  try { original = JSON.parse(text); } catch { throw new TypeError("CO-OPS returned non-JSON source bytes"); }
  if (original === null || typeof original !== "object" || Array.isArray(original) ||
      original.error !== undefined || String(original.metadata?.id) !== admitted.station ||
      !Array.isArray(original.data) || original.data.length === 0 ||
      original.data.length > 300) {
    throw new Error("CO-OPS source has no admissible station-matched observed levels");
  }
  const day = calendarDate(admitted.date);
  const observations = original.data.map(row => {
    const observedAt = observationDate(row?.t, day);
    if (typeof row.v !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(row.v) ||
        !Number.isFinite(Number(row.v))) {
      throw new TypeError("CO-OPS water level is not a finite decimal metre observation");
    }
    return Object.freeze({
      observedAt, heightMeters: Number(row.v),
      originalValue: row.v,
      // NOAA's supplied sigma/quality flags remain opaque: the buyer can
      // interpret them through the source's dated quality documentation.
      ...(row.s === undefined ? {} : { sigma: row.s }),
      ...(row.f === undefined ? {} : { flags: row.f }),
      ...(row.q === undefined ? {} : { quality: row.q }),
    });
  });
  for (let i = 1; i < observations.length; i++) {
    if (observations[i].observedAt <= observations[i - 1].observedAt) {
      throw new Error("CO-OPS source timestamps are duplicated or non-monotonic");
    }
  }
  const receivedAt = now();
  if (typeof receivedAt !== "string" || !Number.isFinite(Date.parse(receivedAt)) ||
      new Date(receivedAt).toISOString() !== receivedAt) {
    throw new TypeError("CO-OPS acquisition receipt needs a canonical UTC instant");
  }
  const delivered = {
    kind: "noaa-coops-water-level-day/v1",
    station: admitted.station, date: admitted.date,
    product: "water_level", datum: admitted.datum ?? "MLLW", unit: "metre", timeZone: "GMT",
    measurementState: "source-reported-possibly-preliminary",
    observations,
    source: {
      url, identity: makeNiUri(bytes), bytes: bytes.byteLength,
      text, receivedAt,
      attribution: "NOAA National Ocean Service, Center for Operational Oceanographic Products and Services",
      rights: {
        authority: "https://oceanservice.noaa.gov/disclaimer.html",
        api: "https://api.tidesandcurrents.noaa.gov/api/prod/",
        notice: "561 Group derived representation; original public NOAA data not claimed as proprietary, and no NOAA endorsement is asserted.",
      },
      sourceMetadata: original.metadata,
    },
  };
  return admitCanonicalJson(JSON.stringify(delivered), RESPONSE_ENVELOPE).value;
}
