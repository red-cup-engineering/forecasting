/**
 * A JSONL file that may have been sealed. The research state directories (combo-backfill runs, the combo collector's
 * `combos/`, the crypto shadow's) held every row as plain text: 1.2 GB for one weekend's backfill, 1.1 GB for the
 * collector, of which JSON text compresses about ten to one. A sealed file is `<name>.gz`, gzip members appended in
 * order (any gzip tool reads it; zlib reads the members as one stream); a collector that is still running keeps
 * appending plain rows to `<name>`. A reader asks for the file by its plain name and gets the sealed rows, then the plain
 * ones, as one stream.
 *
 *   jsonlLines(file)       async iterator of the file's non-empty lines (the sealed part, then the plain part)
 *   jsonlRows(file)        async iterator of parsed rows; a line that does not parse (a torn last line) is skipped
 *   jsonlRowsSync(file)    the same as an array
 *   jsonlExists(file)      whether either part exists
 *   sealJsonl(file, {minAgeMs})  append the plain part to `<file>.gz`, verify the gzip reads back to the same bytes, then remove the plain file
 */
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const partsOf = (file) => [`${file}.gz`, file].filter((part) => existsSync(part));
export const jsonlExists = (file) => partsOf(file).length > 0;

export async function* jsonlLines(file) {
  for (const part of partsOf(file)) {
    const input = part.endsWith('.gz') ? createReadStream(part).pipe(createGunzip()) : createReadStream(part);
    for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line) yield line;
  }
}
export async function* jsonlRows(file) {
  for await (const line of jsonlLines(file)) { try { yield JSON.parse(line); } catch { /* a torn line */ } }
}
export function jsonlRowsSync(file) {
  const rows = [];
  for (const part of partsOf(file)) {
    const text = part.endsWith('.gz') ? gunzipSync(readFileSync(part)).toString('utf8') : readFileSync(part, 'utf8');
    for (const line of text.split('\n')) if (line) { try { rows.push(JSON.parse(line)); } catch { /* a torn line */ } }
  }
  return rows;
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
/** Seal the plain part of a JSONL file. Resolves {before, after} bytes, or null when there was nothing to seal. */
export function sealJsonl(file, { minAgeMs = 0, now = Date.now() } = {}) {
  if (!existsSync(file) || (minAgeMs > 0 && now - statSync(file).mtimeMs < minAgeMs)) return null;
  const plain = readFileSync(file);
  if (!plain.length) { unlinkSync(file); return null; }
  // A torn last line stays out of the seal: it is kept in the plain file, where the writer may yet finish it.
  const cut = plain.lastIndexOf(0x0a) + 1;
  if (cut === 0) return null;
  const body = plain.subarray(0, cut), tail = plain.subarray(cut), sealed = `${file}.gz`;
  const member = gzipSync(body, { level: 6 });
  if (sha(gunzipSync(member)) !== sha(body)) throw new Error(`${file}: the gzip does not read back to the same bytes; left as it was`);
  const before = (existsSync(sealed) ? statSync(sealed).size : 0) + plain.length;
  appendFileSync(sealed, member, { mode: 0o644 });
  if (sha(gunzipSync(readFileSync(sealed)).subarray(-body.length)) !== sha(body)) throw new Error(`${sealed}: the appended member does not read back; the plain file is kept`);
  if (tail.length) { writeFileSync(`${file}.tmp`, tail); renameSync(`${file}.tmp`, file); } else unlinkSync(file);
  return { before, after: statSync(sealed).size };
}
