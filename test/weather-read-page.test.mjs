import assert from "node:assert/strict";
import test from "node:test";
import { weatherReadPage, weatherStatusInventory } from "../src/weather-read-page.mjs";

const source = { revision: "sha256:" + "a".repeat(64), file: "latest.json" };

test("all 5000 recorded grade members remain retrievable through bounded pages", () => {
  const grades = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`station/model/${String(i).padStart(5,"0")}`, { n: i, source: "actual-observation" }]));
  const seen = [];
  let offset = 0;
  do {
    const page = weatherReadPage({ grades }, { source, field: "grades", allowedFields: ["grades"], offset, limit: 100, sourceRevision: source.revision });
    assert.equal(page.total, 5000); assert.equal(page.source, source);
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
  assert.equal(inventory.marketCount, 1700); assert.equal(inventory.source, source);
  assert.equal(inventory.grades, undefined); assert.equal(inventory.forecasts, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) < 2048);
  assert.equal(Object.keys(record.grades).length, 5000);
});
