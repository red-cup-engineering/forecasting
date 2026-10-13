import assert from "node:assert/strict";
import test from "node:test";
import { weatherReadPage, weatherStatusInventory } from "../src/weather-read-page.mjs";
import { makeNiUri, verifyNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { readWeatherSourceRecord } from "../src/weather-source-record.mjs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceBytes = new TextEncoder().encode('{"record":"same original bytes"}\n');
const source = { revision: makeNiUri(sourceBytes), file: "latest.json", at: null };

test("all 5000 recorded grade members remain retrievable through bounded pages", () => {
  const grades = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`station/model/${String(i).padStart(5,"0")}`, { n: i, source: "actual-observation" }]));
  const seen = [];
  let offset = 0;
  do {
    const page = weatherReadPage({ grades }, { source, field: "grades", allowedFields: ["grades"], offset, limit: 100, sourceRevision: source.revision });
    assert.equal(page.total, 5000); assert.deepEqual(page.source, source);
    assert.equal(verifyNiUri(sourceBytes, page.source.revision), true);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 65_536);
    for (const row of page.rows) { assert.deepEqual(row.value, grades[row.key]); seen.push(row.key); }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(seen, Object.keys(grades).sort());
  assert.equal(new Set(seen).size, 5000);
});

test("byte-bound pages resume at the first unreturned complete comparison row", () => {
  const comparisons = Array.from({ length: 2000 }, (_, i) => ({ id: i, scientificMeaning: "measurement".repeat(150) }));
  const first = weatherReadPage({ comparisons }, { source, field: "comparisons", allowedFields: ["comparisons"] });
  assert.ok(first.rows.length > 0 && first.rows.length < 100); assert.equal(first.nextOffset, first.rows.length);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 65_536);
  const second = weatherReadPage({ comparisons }, { source, field: "comparisons", allowedFields: ["comparisons"], offset: first.nextOffset });
  assert.equal(second.rows[0].value.id, first.rows.length);
  assert.equal(first.total, 2000); assert.equal(second.total, 2000);
});

test("a changed source or oversized single row refuses instead of truncating evidence", () => {
  const options = { source, field: "grades", allowedFields: ["grades"] };
  assert.throws(() => weatherReadPage({ grades: {} }, { ...options, sourceRevision: "other-source" }), /revision changed/u);
  assert.throws(() => weatherReadPage({ grades: { large: { text: "x".repeat(70_000) } } }, options), /one weather row/u);
  const tooManyMembers = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`m${i}`, 0]));
  assert.throws(() => weatherReadPage({ grades: { oversized: tooManyMembers } }, options), error => error.cause?.code === "object-member-limit");
  for (const patch of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: .5 }]) assert.throws(() => weatherReadPage({}, { ...options, ...patch }), RangeError);
  assert.throws(() => weatherReadPage({}, { ...options, field: "secret" }), TypeError);
});

test("status inventories complete counts without carrying the oversized collections", () => {
  const record = { at: "2026-10-13T17:00:00Z", marketCount: 1700, grades: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [i, { n: 7 }])), forecasts: Array(1800).fill({ models: [] }) };
  const inventory = weatherStatusInventory(record, { source });
  assert.equal(inventory.collections.find(row => row.field === "grades").count, 5000);
  assert.equal(inventory.collections.find(row => row.field === "forecasts").count, 1800);
  assert.equal(inventory.marketCount, 1700); assert.deepEqual(inventory.source, source);
  assert.equal(inventory.grades, undefined); assert.equal(inventory.forecasts, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) < 2048);
  assert.equal(Object.keys(record.grades).length, 5000);
});

test("scientific metadata is charged inside the final canonical page budget", () => {
  const comparisons = Array.from({ length: 100 }, (_, i) => ({ id: i, meaning: "x".repeat(1500) }));
  const metadata = { truth: "recorded source " + "x".repeat(1500), scoring: "shared scoring description", pending: 7, missingOutcomes: 2, orderEffect: false };
  const page = weatherReadPage({ comparisons }, { source, field: "comparisons", allowedFields: ["comparisons"], metadata });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 65_536);
  assert.equal(page.truth, metadata.truth); assert.equal(page.pending, 7); assert.equal(page.nextOffset, page.rows.length);
  assert.throws(() => weatherReadPage({ comparisons }, { source, field: "comparisons", allowedFields: ["comparisons"], metadata: { truth: "x".repeat(70_000) } }), /source-limit|canonical-limit/u);
});

test("inventory refuses oversized strings and unknown objects in scalar slots", () => {
  for (const patch of [{ status: {} }, { at: [] }, { status: "x".repeat(2049) }, { marketCount: {} }, { modelled: "12" }, { complete: {} }]) {
    assert.throws(() => weatherStatusInventory(patch, { source }), TypeError);
  }
  assert.throws(() => weatherStatusInventory({}, { source, lastFailure: { reason: {} } }), TypeError);
  assert.throws(() => weatherStatusInventory({}, { source, running: "process" }), TypeError);
});

test("actual source-file read binds a complete page to the original bytes and detects changed or absent sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "weather-page-"));
  try {
    const original = '{"at":"2026-10-13T17:00:00Z","grades":{"first":{"n":1},"second":{"n":2}}}\n';
    await writeFile(join(root,"latest.json"),original);
    const first = await readWeatherSourceRecord({ root, file: "latest.json" });
    assert.equal(first.source.revision, makeNiUri(new TextEncoder().encode(original)));
    assert.equal(verifyNiUri(await readFile(join(root,"latest.json")),first.source.revision),true);
    const page = weatherReadPage(first.record, { source:first.source, field:"grades", allowedFields:["grades"], limit:1, metadata:{orderEffect:false} });
    assert.equal(page.total,2); assert.equal(page.nextOffset,1); assert.deepEqual(page.rows[0],{key:"first",value:{n:1}});
    assert.equal(await readFile(join(root,"latest.json"),"utf8"),original);
    await writeFile(join(root,"latest.json"),original.replace('"n":2','"n":3'));
    await assert.rejects(()=>readWeatherSourceRecord({root,file:"latest.json",sourceRevision:page.source.revision}),/revision changed/u);
    const missing=await readWeatherSourceRecord({root,file:"state.json"});
    assert.deepEqual(missing.source,{file:"state.json",present:false,revision:"absent",at:null});
    await assert.rejects(()=>readWeatherSourceRecord({root,file:"../secret"}),TypeError);
    await writeFile(join(root,"latest.json"),'{"at":{"invalid":"timestamp"}}');
    await assert.rejects(()=>readWeatherSourceRecord({root,file:"latest.json"}),TypeError);
  } finally { await rm(root,{recursive:true,force:true}); }
});
