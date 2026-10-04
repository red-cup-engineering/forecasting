// Live public-data fetchers (Atlanta Fed GDPNow workbook, Yahoo ZQ, NY Fed EFFR, Deribit DVOL, Coinbase, Yahoo CL=F). Injectable in tests.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { UA, getJson, num, stateRoot } from './common.mjs';
import { isDailyEvent, parseChart } from './wti.mjs';
import { zqSymbol } from './fed.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheDir = (root) => { const d = join(root, 'cache'); mkdirSync(d, { recursive: true }); return d; };
const fresh = (f, ms) => existsSync(f) && Date.now() - statSync(f).mtimeMs < ms;

export function liveFetchers({ root = stateRoot() } = {}) {
  return {
    async gdpnow() {
      const out = join(cacheDir(root), 'gdpnow.json');
      if (fresh(out, 3 * 3600e3)) return JSON.parse(readFileSync(out, 'utf8'));
      const xlsx = join(cacheDir(root), 'gdpnow.xlsx');
      const res = await fetch('https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/research-and-data/data/gdpnow/GDPTrackingModelDataAndForecasts.xlsx', { headers: UA, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`gdpnow http-${res.status}`);
      writeFileSync(xlsx, Buffer.from(await res.arrayBuffer()));
      const { stdout } = await run('python3', [join(here, '..', '..', 'scripts', 'category-shadows-gdpnow.py'), xlsx], { timeout: 180000, maxBuffer: 1 << 20 });
      const v = JSON.parse(stdout.trim().split('\n').pop()); writeFileSync(out, JSON.stringify(v)); return v;
    },
    async fed(meetings) {
      const e = await getJson('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json');
      const effr = Number(e.refRates[0].percentRate);
      const need = new Map();
      for (const d of meetings) for (const [y, m] of [[d.getUTCFullYear(), d.getUTCMonth() + 1], d.getUTCMonth() === 11 ? [d.getUTCFullYear() + 1, 1] : [d.getUTCFullYear(), d.getUTCMonth() + 2]]) need.set(zqSymbol(y, m), [y, m]);
      const prices = new Map();
      for (const [sym, [y, m]] of need) {
        try { const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`); const p = j.chart.result?.[0]?.meta?.regularMarketPrice; if (Number.isFinite(p)) prices.set(`${y}-${m}`, p); } catch { /* missing contract -> null */ }
        await sleep(150);
      }
      return { effr, price: (y, m) => prices.get(`${y}-${m}`) ?? null };
    },
    /** CL=F 5-minute bars, 60 days (the backtest's source: Yahoo chart JSON). Cached 4 minutes; fetched only when a wti window is open. */
    async wtiBars() {
      const out = join(cacheDir(root), 'wti-bars.json');
      if (fresh(out, 4 * 60e3)) return JSON.parse(readFileSync(out, 'utf8'));
      const bars = parseChart(await getJson('https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?range=60d&interval=5m', { timeoutMs: 60000 }));
      writeFileSync(out, JSON.stringify(bars)); return bars;
    },
    /** Settled KXWTI daily events of the last 58 days: [{ closeSec, val }] (ICE settle value per event). Cached 2 hours. */
    async wtiSettled(client) {
      const out = join(cacheDir(root), 'wti-settled.json');
      if (fresh(out, 2 * 3600e3)) return JSON.parse(readFileSync(out, 'utf8'));
      const ms = await client.getMarkets({ series_ticker: 'KXWTI', status: 'settled', min_close_ts: Math.floor(Date.now() / 1000) - 58 * 86400 });
      const ev = new Map();
      for (const m of ms) { const v = num(m.expiration_value); if (isDailyEvent(m.event_ticker) && v !== null && !ev.has(m.event_ticker)) ev.set(m.event_ticker, { closeSec: Date.parse(m.close_time) / 1000, val: v }); }
      const list = [...ev.values()]; writeFileSync(out, JSON.stringify(list)); return list;
    },
    async btcSpotDvol() {
      const t = await getJson('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
      const end = Date.now(); const d = await getJson(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${end - 3 * 3600e3}&end_timestamp=${end}&resolution=60`);
      const last = d.result.data.at(-1); return { spot: Number(t.price), dvol: last[4] / 100 };
    },
    /** Mean over the prior 30 days of realised variance (sum of squared 5-min log returns) in the same UTC window [close - hours, close]. */
    async varTod(closeMs, hours) {
      const key = join(cacheDir(root), `tod-${new Date(closeMs).toISOString().slice(0, 13)}.json`);
      if (existsSync(key)) return JSON.parse(readFileSync(key, 'utf8')).v;
      const vs = [];
      for (let k = 1; k <= 30; k += 1) {
        const end = closeMs - k * 86400e3; const start = end - hours * 3600e3;
        try {
          const c = await getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`);
          const cs = c.filter((x) => x[0] * 1000 >= start && x[0] * 1000 <= end).sort((a, b) => a[0] - b[0]);
          if (cs.length > 0.8 * hours * 12) { let s = 0; for (let i = 1; i < cs.length; i += 1) s += Math.log(cs[i][4] / cs[i - 1][4]) ** 2; vs.push(s); }
        } catch { /* skip day */ }
        await sleep(120);
      }
      const v = vs.length >= 10 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
      writeFileSync(key, JSON.stringify({ v, n: vs.length })); return v;
    },
  };
}
