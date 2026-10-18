#!/usr/bin/env node
/**
 * Move a host's forecasting-service research data into the shared market-data cache and seal its JSONL.
 *
 *   node scripts/migrate-market-data.mjs [--root <forecasting-service settlement>] [--cache <dir>] [--min-age-hours 24] [--apply] [--json]
 *
 * DRY RUN BY DEFAULT: nothing under --root or --cache is written or removed; the report is what --apply would do and free.
 * (The dry run builds the shared cache in a temporary directory so that the sizes are measured, not guessed, and removes it.)
 *
 *   combo-backfill/<run>/cache/tape/<minTs>.json     -> cache.tape (src/market-data-cache.mjs), verified by reading it back
 *   combo-backfill/<run>/cache/candles/<minTs>.json  -> cache.candles per (series, day), verified row for row
 *   every *.jsonl in the research directories        -> sealed `*.jsonl.gz` (src/jsonl-file.mjs), verified by gunzip, when untouched
 *                                                       for --min-age-hours (so no running collector's file is taken)
 * With --apply a legacy tape or candles file is removed only after its content has been read back from the cache equal; a JSONL
 * only after its gzip has been read back equal. Anything that does not verify is left and reported. Exit 1 if any did not.
 */
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { createMarketDataCache, marketDataCacheDir } from '../src/market-data-cache.mjs';
import { sealJsonl } from '../src/jsonl-file.mjs';

const forecastingRoot = (env = process.env) => join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service');
const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };
const treeBytes = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? treeBytes(join(dir, e.name)) : sizeOf(join(dir, e.name))), 0) : 0);
const tails = (d) => (existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')).sort() : []);

/** The gzip size of a file, streamed. */
async function gzipBytes(file) {
  let n = 0;
  await pipeline(createReadStream(file), createGzip({ level: 6 }), new Writable({ write(chunk, _e, done) { n += chunk.length; done(); } }));
  return n;
}
const jsonlFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsonlFiles(join(dir, e.name)) : e.name.endsWith('.jsonl') ? [join(dir, e.name)] : [])) : []);

export async function migrateMarketData({ root = forecastingRoot(), cacheDirectory = marketDataCacheDir(), apply = false, minAgeMs = 24 * 3600_000, now = Date.now() } = {}) {
  const staging = apply ? null : mkdtempSync(join(tmpdir(), 'market-data-cache-'));
  const cache = createMarketDataCache({ dir: apply ? cacheDirectory : staging });
  const report = { root, apply, cache: apply ? cacheDirectory : '(temporary, removed)', runs: [], jsonl: [], bytesBefore: 0, bytesAfter: 0, failed: 0 };
  try {
    const cacheBefore = apply ? treeBytes(cacheDirectory) : 0;
    const backfill = join(root, 'combo-backfill');
    for (const run of existsSync(backfill) ? readdirSync(backfill).sort() : []) {
      const dir = join(backfill, run, 'cache');
      if (!existsSync(dir)) continue;
      const entry = { run, tape: { files: 0, bytes: 0, verified: 0 }, candles: { files: 0, bytes: 0, verified: 0, rows: 0 }, problems: [] };
      const tapeByMin = new Map();
      for (const name of tails(join(dir, 'tape'))) {
        const file = join(dir, 'tape', name), record = JSON.parse(readFileSync(file, 'utf8'));
        entry.tape.files += 1; entry.tape.bytes += sizeOf(file);
        await cache.tape.put(record.minTs, record.maxTs, record);
        tapeByMin.set(record.minTs, record);
        if (JSON.stringify(await cache.tape.get(record.minTs, record.maxTs)) === JSON.stringify(record)) { entry.tape.verified += 1; if (apply) rmSync(file); } else entry.problems.push(`tape ${name} did not read back`);
      }
      for (const name of tails(join(dir, 'candles'))) {
        const file = join(dir, 'candles', name), rows = JSON.parse(readFileSync(file, 'utf8')), minTs = Number(name.replace('.json', ''));
        const window = tapeByMin.get(minTs);
        entry.candles.files += 1; entry.candles.bytes += sizeOf(file); entry.candles.rows += rows.length;
        if (!window) { entry.problems.push(`candles ${name}: no tape window to say its range`); continue; }
        const from = minTs - 1800, to = window.maxTs, tickers = [...new Set(rows.map((r) => r.ticker))];
        await cache.candles.add(tickers, from, to, rows);
        await cache.flush();
        const key = (r) => `${r.ticker}@${r.ts}@${r.bid}@${r.ask}`;
        const want = new Set(rows.map(key)), got = new Set((await cache.candles.rows(tickers, from, to)).map(key));
        if (want.size === got.size && [...want].every((k) => got.has(k))) { entry.candles.verified += 1; if (apply) rmSync(file); } else entry.problems.push(`candles ${name} did not read back row for row`);
      }
      await cache.flush();
      report.failed += entry.problems.length;
      report.runs.push(entry);
      report.bytesBefore += entry.tape.bytes + entry.candles.bytes;
    }
    const cacheAfter = treeBytes(join(apply ? cacheDirectory : staging, 'content-tree')) - (apply ? cacheBefore : 0);
    report.bytesAfter += Math.max(0, cacheAfter);
    // JSONL: every research directory
    for (const dir of ['combo-backfill', 'combos', 'crypto-shadow', 'generator-lag', 'generator-lag-all', 'category-shadows'].map((d) => join(root, d))) {
      for (const file of jsonlFiles(dir)) {
        const before = sizeOf(file);
        if (now - statSync(file).mtimeMs < minAgeMs) { report.jsonl.push({ file, before, after: before, sealed: false, note: 'written within the minimum age; left' }); report.bytesBefore += before; report.bytesAfter += before; continue; }
        let after;
        try {
          if (apply) { sealJsonl(file, { minAgeMs, now }); after = sizeOf(`${file}.gz`) + sizeOf(file); }
          else after = await gzipBytes(file);
          report.jsonl.push({ file, before, after, sealed: apply });
        } catch (error) { report.failed += 1; after = before; report.jsonl.push({ file, before, after: before, sealed: false, note: error.message }); }
        report.bytesBefore += before; report.bytesAfter += after;
      }
    }
  } finally { if (staging) rmSync(staging, { recursive: true, force: true }); }
  report.freed = report.bytesBefore - report.bytesAfter;
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, cache: { type: 'string' }, 'min-age-hours': { type: 'string', default: '24' }, apply: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  try {
    const report = await migrateMarketData({ root: values.root ?? forecastingRoot(), cacheDirectory: values.cache ?? marketDataCacheDir(), apply: values.apply, minAgeMs: Number(values['min-age-hours']) * 3600_000 });
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`${report.apply ? 'APPLIED' : 'DRY RUN (nothing written)'}: ${report.root}\n`);
      for (const r of report.runs) process.stdout.write(`  ${r.run}: tape ${r.tape.verified}/${r.tape.files} (${r.tape.bytes} B), candles ${r.candles.verified}/${r.candles.files} (${r.candles.bytes} B, ${r.candles.rows} rows)${r.problems.length ? `  PROBLEMS: ${r.problems.join('; ')}` : ''}\n`);
      for (const j of report.jsonl) process.stdout.write(`  jsonl ${j.file} ${j.before} -> ${j.after}${j.note ? ` (${j.note})` : ''}\n`);
      process.stdout.write(`bytes ${report.bytesBefore} -> ${report.bytesAfter}; ${report.apply ? 'freed' : 'would free'} ${report.freed}; ${report.failed} problem(s)\n`);
    }
    process.exitCode = report.failed ? 1 : 0;
  } catch (error) { process.stderr.write(`migrate-market-data: ${error.stack ?? error.message}\n`); process.exitCode = 2; }
}
