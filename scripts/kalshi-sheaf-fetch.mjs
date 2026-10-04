// Fetch settled Kalshi daily-temperature markets and hourly candles (public data, read-only).
// usage: node scripts/kalshi-sheaf-fetch.mjs [outDir] [minCloseISO]
import fs from "node:fs";
import path from "node:path";
const B = "https://api.elections.kalshi.com/trade-api/v2";
const UA = { accept: "application/json", "user-agent": "561-group research (ops@561.group)" };
const here = path.dirname(new URL(import.meta.url).pathname);
const rec = path.join(here, "../data/records/2026-10-04-kalshi-sheaf");
const out = process.argv[2] || path.join(rec, "data");
const minClose = Math.floor(Date.parse(process.argv[3] || "2026-08-15T00:00:00Z") / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 6; i++) {
    try {
      await sleep(80);
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      if ([429, 500, 502, 503, 504].includes(r.status)) { await sleep(2 ** i * 500); continue; }
      throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i === 5) throw e; await sleep(2 ** i * 500); }
  }
}
const num = (x) => (x == null ? null : Number(x));
fs.mkdirSync(out, { recursive: true });
const series = fs.readFileSync(path.join(rec, "series.txt"), "utf8").trim().split("\n").map((l) => l.split(/\s+/));
for (const [s, station] of series) {
  const file = path.join(out, `${s}.json`);
  if (fs.existsSync(file)) continue;
  let cursor = "", ms = [];
  for (;;) {
    const q = new URLSearchParams({ series_ticker: s, status: "settled", limit: "1000", min_close_ts: String(minClose) });
    if (cursor) q.set("cursor", cursor);
    const d = await get(`${B}/markets?${q}`);
    ms = ms.concat(d.markets || []);
    cursor = d.cursor;
    if (!cursor || !(d.markets || []).length) break;
  }
  const res = [];
  for (let i = 0; i < ms.length; i += 40) {
    const chunk = ms.slice(i, i + 40);
    const st = Math.min(...chunk.map((m) => Date.parse(m.open_time) / 1000));
    const en = Math.max(...chunk.map((m) => Date.parse(m.close_time) / 1000));
    const q = new URLSearchParams({ market_tickers: chunk.map((m) => m.ticker).join(","), start_ts: String(st), end_ts: String(en), period_interval: "60" });
    const d = await get(`${B}/markets/candlesticks?${q}`);
    const byT = Object.fromEntries((d.markets || []).map((x) => [x.market_ticker, x.candlesticks]));
    for (const m of chunk) {
      res.push({
        ticker: m.ticker, event: m.event_ticker, strike: m.strike_type, floor: m.floor_strike ?? null, cap: m.cap_strike ?? null,
        value: num(m.expiration_value), result: m.result, close: m.close_time, volume: num(m.volume_fp),
        candles: (byT[m.ticker] || []).map((c) => [c.end_period_ts, num(c.yes_bid?.close_dollars), num(c.yes_ask?.close_dollars), num(c.price?.close_dollars), num(c.volume_fp), num(c.open_interest_fp)]),
      });
    }
  }
  fs.writeFileSync(file, JSON.stringify({ series: s, station, markets: res }));
  console.error(s, ms.length);
}
