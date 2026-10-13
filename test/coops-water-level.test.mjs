import assert from "node:assert/strict";
import test from "node:test";
import { verifyNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import {
  admitNoaaCoopsWaterLevel, coopsWaterLevelUrl, readNoaaCoopsWaterLevel,
} from "../src/coops-water-level.mjs";

const request = Object.freeze({ station: "9414290", date: "20261012" });
const payload = {
  metadata: { id: "9414290", name: "San Francisco", lat: "37.8063", lon: "-122.4659" },
  data: [
    { t: "2026-10-12 00:00", v: "1.234", s: "0.010", f: "0,0,0,0", q: "p" },
    { t: "2026-10-12 00:06", v: "1.250", s: "0.012", f: "0,0,0,0", q: "v" },
  ],
};
const text = JSON.stringify(payload);
const response = (v = text, status = 200) => new Response(v, {
  status, headers: { "content-type": "application/json" },
});
const now = () => "2026-10-13T00:00:00.000Z";

test("pure admission fixes station and exact UTC calendar date before network access", () => {
  assert.deepEqual(admitNoaaCoopsWaterLevel(request), request);
  const url = new URL(coopsWaterLevelUrl(request));
  assert.equal(url.origin, "https://api.tidesandcurrents.noaa.gov");
  assert.equal(url.pathname, "/api/prod/datagetter");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    begin_date: "20261012", end_date: "20261012", station: "9414290",
    product: "water_level", datum: "MLLW", time_zone: "gmt",
    units: "metric", format: "json", application: "561Group",
  });
  for (const invalid of [
    null, [], {}, {station:"9414290"}, {station:"9414290",date:"20260230"},
    {station:"9414290",date:"20261312"}, {station:"9414290",date:"2026-10-12"},
    {station:"../../etc",date:"20261012"}, {station:"cb0102",date:"20261012"},
    {station:"9414290",date:"20261012",url:"https://private.example/"},
    {station:"9414290",date:"20261012",datum:"STND"},
  ]) assert.throws(() => admitNoaaCoopsWaterLevel(invalid), TypeError);
});

test("bounded source preserves NOAA original bytes, NI, exact datum, values and opaque quality flags", async () => {
  let called = 0;
  const result = await readNoaaCoopsWaterLevel(request, {
    now, fetchImpl: async (url, init) => {
      called++;
      assert.equal(url, coopsWaterLevelUrl(request));
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      return response();
    },
  });
  assert.equal(called, 1);
  assert.equal(result.kind, "noaa-coops-water-level-day/v1");
  assert.equal(result.station, request.station);
  assert.equal(result.product, "water_level");
  assert.equal(result.datum, "MLLW");
  assert.equal(result.unit, "metre");
  assert.equal(result.timeZone, "GMT");
  assert.equal(result.measurementState, "source-reported-possibly-preliminary");
  assert.equal(result.observations[0].heightMeters, 1.234);
  assert.equal(result.observations[0].quality, "p");
  assert.equal(result.observations[1].quality, "v");
  assert.equal(result.observations[1].observedAt, "2026-10-12T00:06:00.000Z");
  assert.equal(result.source.text, text);
  assert.equal(result.source.bytes, new TextEncoder().encode(text).length);
  assert.equal(verifyNiUri(new TextEncoder().encode(text), result.source.identity), true);
  assert.equal(result.source.receivedAt, now());
  assert.equal(result.source.rights.authority, "https://oceanservice.noaa.gov/disclaimer.html");
  assert.equal(result.source.sourceMetadata.id, request.station);
  assert.match(result.source.rights.notice, /no NOAA endorsement/u);
});

test("invalid requests refuse without network effects; station, time and quality readings remain source-bound", async () => {
  let effects = 0;
  await assert.rejects(readNoaaCoopsWaterLevel({ ...request, date: "20261088" },
    { fetchImpl: async () => { effects++; return response(); } }), TypeError);
  assert.equal(effects, 0);
  const cases = [
    [{ ...payload, metadata: { id: "8518750" } }, /station-matched/u],
    [{ ...payload, data: [] }, /station-matched/u],
    [{ ...payload, error: { message: "unsupported datum" } }, /station-matched/u],
    [{ ...payload, data: [{ t: "2026-10-13 00:00", v: "1.234" }] }, /outside requested/u],
    [{ ...payload, data: [{ t: "2026-10-12 00:00", v: "NaN" }] }, /finite decimal/u],
    [{ ...payload, data: [...payload.data].reverse() }, /non-monotonic/u],
    [{ ...payload, data: [payload.data[0], payload.data[0]] }, /non-monotonic/u],
  ];
  for (const [source, diagnostic] of cases) {
    await assert.rejects(readNoaaCoopsWaterLevel(request, {
      now, fetchImpl: async () => response(JSON.stringify(source)),
    }), diagnostic);
  }
  await assert.rejects(readNoaaCoopsWaterLevel(request, { now, fetchImpl: async () => response("{broken") }), /non-JSON/u);
  await assert.rejects(readNoaaCoopsWaterLevel(request, { now, fetchImpl: async () => response("down",503) }), /refused or redirected/u);
});

test("response redirects and oversized streaming sources refuse instead of producing goods", async () => {
  const redirected = response();
  Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(readNoaaCoopsWaterLevel(request, {now,fetchImpl:async()=>redirected}),/redirected/u);
  const changedOrigin = response();
  Object.defineProperty(changedOrigin, "url", { value: "https://other.example/" });
  await assert.rejects(readNoaaCoopsWaterLevel(request, {now,fetchImpl:async()=>changedOrigin}),/redirected/u);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("A".repeat(131073))); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readNoaaCoopsWaterLevel(request, {now,fetchImpl:async()=>new Response(body)}),
    error => error.code === "body-too-large");
  assert.equal(cancelled, true);
});
