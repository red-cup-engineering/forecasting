import { admitCanonicalJson, JSON_RESOURCE_ENVELOPE } from "@red-cup-engineering/json-services-section/canonical-json";

const PAGE_BYTES = 65_536;
const PAGE_ENVELOPE = Object.freeze({ ...JSON_RESOURCE_ENVELOPE, maxSourceBytes: PAGE_BYTES, maxCanonicalBytes: PAGE_BYTES });
// Admit the same JSON wire projection the existing RPC transport carries.
// This retains the upstream object/depth/string bounds, not just byte size.
const wireBytes = value => admitCanonicalJson(JSON.stringify(value), PAGE_ENVELOPE).byteLength;

export function admitWeatherPageWire(value) {
  return admitCanonicalJson(JSON.stringify(value), PAGE_ENVELOPE).value;
}

/** Page an existing record field without changing the source or losing rows. */
export function weatherReadPage(record, { source, field, allowedFields, offset = 0, limit = 100, sourceRevision, metadata = {} } = {}) {
  if (!source || typeof source.revision !== "string" || source.revision.length > 160) throw new TypeError("one recorded source revision is required");
  if (sourceRevision !== undefined && sourceRevision !== source.revision) throw new Error("weather source revision changed; restart paging from offset zero");
  if (!allowedFields?.includes(field)) throw new TypeError("field must name an admitted weather record collection");
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("weather page requires nonnegative offset and limit from 1 through 100");
  const value = record[field];
  const entries = Array.isArray(value) ? value.map((value, index) => [index, value]) : value && typeof value === "object" ? Object.keys(value).sort().map(key => [key, value[key]]) : [];
  const response = { ...metadata, source, field, offset, total: entries.length, nextOffset: null, rows: [] };
  let byteLength = wireBytes(response) + 32; // reserve the next-offset numeral
  for (const [key, value] of entries.slice(offset, offset + limit)) {
    const row = { key, value };
    let rowBytes;
    try { rowBytes = wireBytes(row); }
    catch (error) { throw new RangeError("one weather row violates the bounded canonical carrier; select a narrower source field", { cause: error }); }
    if (byteLength + rowBytes + 1 > PAGE_BYTES) {
      if (response.rows.length === 0) throw new RangeError("one weather row exceeds the bounded page; select a narrower source field");
      response.nextOffset = offset + response.rows.length;
      break;
    }
    response.rows.push(row);
    byteLength += rowBytes + 1;
    response.nextOffset = offset + response.rows.length < entries.length ? offset + response.rows.length : null;
  }
  return admitWeatherPageWire(response);
}

function text(value, name, maxLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) throw new TypeError(`${name} must be a bounded string or absent`);
  return value;
}
function countValue(value, name) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative safe integer or absent`);
  return value;
}

/** Status is a bounded inventory; exact collections remain separately pageable. */
export function weatherStatusInventory(record, { source, running = null, lastFailure = null } = {}) {
  const fields = ["contracts", "forecasts", "grades", "errors", "opportunities", "research", "scoring"];
  const count = value => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
  if (record.complete !== undefined && record.complete !== null && typeof record.complete !== "boolean") throw new TypeError("complete must be a boolean or absent");
  const at = text(record.at, "at", 128);
  if (running !== null && (typeof running !== "object" || Array.isArray(running))) throw new TypeError("running must be a recorded object or absent");
  if (lastFailure !== null && (typeof lastFailure !== "object" || Array.isArray(lastFailure))) throw new TypeError("lastFailure must be a recorded object or absent");
  return admitWeatherPageWire({ source: { ...source, at: text(source?.at, "source.at", 128) },
    status: text(record.status, "status", 2048), at, complete: record.complete ?? null,
    marketCount: countValue(record.marketCount, "marketCount"), modelled: countValue(record.modelled, "modelled"),
    running: running === null ? null : { startedAt: text(running.startedAt, "running.startedAt", 128) },
    lastFailure: lastFailure === null ? null : { startedAt: text(lastFailure.startedAt, "lastFailure.startedAt", 128), failedAt: text(lastFailure.failedAt, "lastFailure.failedAt", 128), reason: text(lastFailure.reason, "lastFailure.reason", 2048) },
    collections: fields.map(field => ({ field, count: count(record[field]) })), orderEffect: false });
}
