// Historic public taker tape for settled markets of the desk's universe (resumable).
// node tape-history.mjs [--days 7] [--kind weather|gas|both] [--pace 150]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, sleep, tradesFor, slimTrade, appendNdjson, dataDir, weatherSeries, gasSeriesAll } from './lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const days = Number(arg('days', 7)), kind = arg('kind', 'both'), pace = Number(arg('pace', 150));
const c = makeClient();
const metaFile = join(dataDir, 'tape-markets.json');
const doneFile = join(dataDir, 'tape-done.json');
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const done = existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, 'utf8')) : {};
const minClose = Math.floor(Date.now() / 1000) - days * 86400;
const lists = [];
if (kind !== 'gas') lists.push(['weather', weatherSeries]);
if (kind !== 'weather') lists.push(['gas', gasSeriesAll]);
for (const [k, list] of lists) {
  for (const s of list) {
    let ms = [];
    try { ms = await c.getMarkets({ series_ticker: s, status: 'settled', min_close_ts: minClose }); } catch (e) { console.error('list', s, e.message); continue; }
    await sleep(pace);
    for (const m of ms) {
      if (done[m.ticker] || !(Number(m.volume_fp) > 0)) continue;
      meta[m.ticker] = { kind: k, series: s, event: m.event_ticker, open: m.open_time, close: m.close_time, result: m.result, strike: m.floor_strike ?? m.cap_strike ?? null, vol: Number(m.volume_fp) };
      try {
        const tr = await tradesFor(c, m.ticker, { maxPages: 30 });
        appendNdjson(join(dataDir, 'tape-history.ndjson'), tr.map(slimTrade));
        done[m.ticker] = tr.length;
      } catch (e) { console.error('trades', m.ticker, e.message); }
      await sleep(pace);
    }
    writeFileSync(metaFile, JSON.stringify(meta)); writeFileSync(doneFile, JSON.stringify(done));
    console.log(s, Object.keys(done).length);
  }
}
