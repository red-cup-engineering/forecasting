#!/usr/bin/env node
// Time-split backtest of the earnings-mention history model against the market quote.
//   node scripts/earnings-mentions-backtest.mjs [--cache DIR] [--out FILE.json] [--score-at h1]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { quoteAt, backtest, releaseMentions, FEATURES, EDGAR_FEATURES } from '../src/earnings-mentions.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const cache = opt('cache', '/tmp/claude-1000/-home-emsenn-info/ff528934-809b-45da-8279-b7a50087597e/scratchpad/cache');
const catalog = JSON.parse(readFileSync(join(cache, 'catalog.json'), 'utf8'));
const OFFSETS = { h24: 24 * 3600e3, h1: 3600e3, m5: 300e3 };
const rows = [];
for (const m of catalog) {
  if (!m.callStart || !['yes', 'no'].includes(m.result)) continue;
  const path = join(cache, 'candles', `${m.ticker}.json`);
  const candles = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const quotes = candles ? Object.fromEntries(Object.entries(OFFSETS).map(([k, off]) => [k, quoteAt(candles, m.callStart - off)])) : null;
  rows.push({ ticker: m.ticker, event: m.event, company: m.series, word: m.word, callStart: m.callStart, result: m.result, quotes });
}
const useEdgar = args.includes('--edgar');
const release = new Map();
if (useEdgar) for (const e of new Set(rows.map((r) => r.event))) { const p = join(cache, 'edgar', `${e}.json`); if (existsSync(p)) { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.text) release.set(e, j.text); } }
const extra = (r) => {
  const text = release.get(r.event);
  if (!text) return { relHit: 0, relMiss: 0, relLogCount: 0 };
  const { count, need } = releaseMentions(r.word, text);
  return { relHit: count >= need ? 1 : 0, relMiss: count >= need ? 0 : 1, relLogCount: Math.log1p(count) };
};
const res = backtest(rows, { scoreAt: opt('score-at', 'h1'), ...(useEdgar ? { names: [...FEATURES, ...EDGAR_FEATURES], extra } : {}) });
if (useEdgar) res.edgar = { eventsWithRelease: release.size, rowsWithRelease: rows.filter((r) => release.has(r.event)).length };
const { _testRows, _stackFit, _model, ...pub } = res;
const outFile = opt('out', null);
if (outFile) writeFileSync(outFile, `${JSON.stringify(pub, null, 2)}\n`);
console.log(JSON.stringify(pub, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v), 1));
