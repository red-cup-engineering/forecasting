import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

/** One byte-exact read shared by the new bounded views, never a new store. */
export async function readWeatherSourceRecord({ root, file, label = file, emptyRecord = {}, sourceRevision } = {}) {
  if (!["latest.json", "state.json"].includes(file)) throw new TypeError("one existing weather record file is required");
  let bytes, present = true;
  try { bytes = await readFile(join(root, file)); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    present = false;
  }
  const record = present ? JSON.parse(bytes.toString("utf8")) : emptyRecord;
  if (record === null || typeof record !== "object" || Array.isArray(record)) throw new TypeError("weather source must contain one JSON record");
  if (record.at !== undefined && record.at !== null && (typeof record.at !== "string" || record.at.length > 128)) throw new TypeError("weather source at must be a bounded string or absent");
  const source = { file: label, present, revision: present ? makeNiUri(bytes) : "absent", at: record.at ?? null };
  if (sourceRevision !== undefined && sourceRevision !== source.revision) throw new Error("weather source revision changed; restart paging from offset zero");
  return { record, source };
}
