import { admitCanonicalJson, JSON_RESOURCE_ENVELOPE } from "@red-cup-engineering/json-services-section/canonical-json";

const PAGE_BYTES = 65_536;
const PAGE_ENVELOPE = Object.freeze({ ...JSON_RESOURCE_ENVELOPE, maxSourceBytes: PAGE_BYTES, maxCanonicalBytes: PAGE_BYTES });
// Admit the same JSON wire projection the existing RPC transport carries.
// This retains the upstream object/depth/string bounds, not just byte size.
const wireBytes = value => admitCanonicalJson(JSON.stringify(value), PAGE_ENVELOPE).byteLength;

/** Page an existing record field without changing the source or losing rows. */
export function weatherReadPage(record, { source, field, allowedFields, offset = 0, limit = 100, sourceRevision } = {}) {
  if (!source || typeof source.revision !== "string" || source.revision.length > 160) throw new TypeError("one recorded source revision is required");
  if (sourceRevision !== undefined && sourceRevision !== source.revision) throw new Error("weather source revision changed; restart paging from offset zero");
  if (!allowedFields?.includes(field)) throw new TypeError("field must name an admitted weather record collection");
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("weather page requires nonnegative offset and limit from 1 through 100");
  const value = record[field];
  const entries = Array.isArray(value) ? value.map((value, index) => [index, value]) : value && typeof value === "object" ? Object.keys(value).sort().map(key => [key, value[key]]) : [];
  const response = { source, field, offset, total: entries.length, nextOffset: null, rows: [] };
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
  wireBytes(response);
  return response;
}

/** Status is a bounded inventory; exact collections remain separately pageable. */
export function weatherStatusInventory(record, { source, running = null, lastFailure = null } = {}) {
  const fields = ["contracts", "forecasts", "grades", "errors", "opportunities", "research", "scoring"];
  const count = value => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
  return { source, status: record.status ?? null, at: record.at ?? null, complete: record.complete ?? null,
    marketCount: record.marketCount ?? null, modelled: record.modelled ?? null, running,
    lastFailure: lastFailure === null ? null : { startedAt: lastFailure.startedAt ?? null, failedAt: lastFailure.failedAt ?? null, reason: String(lastFailure.reason ?? "").slice(0,2048) },
    collections: fields.map(field => ({ field, count: count(record[field]) })), orderEffect: false };
}
