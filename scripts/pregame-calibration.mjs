#!/usr/bin/env node
// Pre-game calibration of Kalshi game-winner markets. Read-only public data. Usage:
//   node pregame-calibration.mjs enumerate   (stage 1: list settled markets per series)
//   node pregame-calibration.mjs candles     (stage 2: fetch candles at start-60/start-5)
//   node pregame-calibration.mjs analyze     (stage 3: tables + pre-registered rules -> stdout JSON/markdown)
// Cache (resumable): CACHE env or default scratchpad pregame-cache.
import fs from "node:fs";
import path from "node:path";
const B = "https://api.elections.kalshi.com/trade-api/v2";
const CACHE = process.env.CACHE || "/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/pregame-cache";
fs.mkdirSync(CACHE, { recursive: true });
const MIN_TS = Date.parse("2026-07-01T00:00:00Z") / 1000, MAX_TS = Date.parse("2026-10-07T00:00:00Z") / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0, consec429 = 0, gap = 420;
export async function get(url) {
  for (;;) {
    const w = gap - (Date.now() - last); if (w > 0) await sleep(w);
    last = Date.now();
    let r;
    try { r = await fetch(url); } catch (e) { await sleep(3000); continue; }
    if (r.status === 429) {
      gap = Math.min(3000, gap * 1.5);
      if (++consec429 > 5) { console.error("5 consecutive 429s: stopping with partial results"); process.exit(3); }
      await sleep(5000 + Math.random() * 15000); continue;
    }
    consec429 = 0; gap = Math.max(420, gap * 0.97);
    if (!r.ok) { if (r.status >= 500) { await sleep(3000); continue; } throw new Error(r.status + " " + url); }
    return r.json();
  }
}
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f))); } catch { return d; } };
const wr = (f, v) => fs.writeFileSync(path.join(CACHE, f), JSON.stringify(v));

// ---- start-time parsing -------------------------------------------------
const TZ = { EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, UTC: 0, GMT: 0, BST: 1, CEST: 2, CET: 1, EEST: 3, EET: 2, JST: 9, KST: 9, AEST: 10, AEDT: 11, IST: 5.5, HKT: 8, SGT: 8, MSK: 3, BRT: -3, ART: -3, AST: -4, NZST: 12, NZDT: 13, WIB: 7, ICT: 7, CST8: 8 };
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// "... scheduled for Oct 7, 2026 at 4:00 PM EDT" -> epoch seconds ; null if absent
export function startFromRules(txt) {
  const m = /(?:on|for)\s+([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+([A-Z]{2,5})/.exec(txt || "");
  if (!m || !(m[7] in TZ) || !(m[1] in MON)) return null;
  let h = +m[4] % 12; if (m[6] === "PM") h += 12;
  return Date.UTC(+m[3], MON[m[1]], +m[2], h, +m[5]) / 1000 - TZ[m[7]] * 3600;
}
// ticker "KXMLBGAME-26OCT041600SDMIL": yyMONddHHMM in ET (verified vs rules text)
export function startFromTicker(ev) {
  const m = /-(\d\d)([A-Z]{3})(\d\d)(\d\d)(\d\d)/.exec(ev);
  if (!m) return null;
  const mon = MON[m[2][0] + m[2].slice(1).toLowerCase()]; if (mon === undefined) return null;
  const y = 2000 + +m[1], d = +m[3];
  // ET offset: EDT (-4) from 2nd Sun Mar to 1st Sun Nov
  const utc0 = Date.UTC(y, mon, d, +m[4], +m[5]) / 1000;
  const off = isEDT(y, mon, d) ? -4 : -5;
  return utc0 - off * 3600;
}
function isEDT(y, mon, d) {
  const nth = (mo, dow, n) => { let c = 0; for (let i = 1; i < 32; i++) { const t = new Date(Date.UTC(y, mo, i)); if (t.getUTCMonth() !== mo) break; if (t.getUTCDay() === dow && ++c === n) return i; } };
  const s = [2, nth(2, 0, 2)], e = [10, nth(10, 0, 1)];
  const k = mon * 100 + d; return k >= s[0] * 100 + s[1] && k < e[0] * 100 + e[1];
}

// ---- stage 1 ------------------------------------------------------------
async function enumerate() {
  let series = rd("series-sports.json", null);
  if (!series) { series = await get(`${B}/series?category=Sports`); wr("series-sports.json", series); }
  // esports, ITF/table-tennis lower tours and non-winner "exact score" series are out of scope
  const SKIP = /^KX(CS2|LOL|VALORANT|DOTA2|R6|CSGO|COD|ROCKETLEAGUE|ITF|ITFW|ITTF|TT|TTELITE|TTSTAR|WTT|ATPEXACT|WTAEXACT|KXECULP|1HOME|1STHOME|WCGOALEVERY|TABLETENNIS|WTABLETENNIS|JUDGEMENTDAY|CHESS|MLBFT|MLBST|NBACELEBRITY|NFLCELEBRITY|FIFA|FIFAUSPULL|FIFAW|EFOOTBALL|ESOCCER|EBASKETBALL|EBBALL|SOBBALL|SOWBBALL|BALLERLEAGUE|UNRIVALED)(GAME|MATCH|FIGHT)$/;
  const cand = series.series.filter((x) => /^KX[A-Z0-9]+(GAME|MATCH|FIGHT)$/.test(x.ticker) && !SKIP.test(x.ticker));
  const done = rd("enumerated.json", {});
  for (const s of cand) {
    if (done[s.ticker]) continue;
    const out = []; let cursor = "";
    for (;;) {
      const j = await get(`${B}/markets?series_ticker=${s.ticker}&status=settled&min_close_ts=${MIN_TS}&max_close_ts=${MAX_TS}&limit=1000${cursor ? "&cursor=" + cursor : ""}`);
      for (const m of j.markets) out.push({ t: m.ticker, e: m.event_ticker, r: m.result, ct: m.close_time, rs: startFromRules(m.rules_primary), vol: +m.volume_fp, ss: m.yes_sub_title, od: m.occurrence_datetime, rp: m.rules_primary && out.length < 1 ? m.rules_primary : undefined });
      cursor = j.cursor; if (!cursor || !j.markets.length) break;
    }
    done[s.ticker] = { fee: s.fee_multiplier, title: s.title, markets: out };
    wr("enumerated.json", done);
    console.error(s.ticker, out.length);
  }
}

// ---- stage 2 ------------------------------------------------------------
// Start time: (1) "scheduled for <date> at <h:mm AM/PM> <TZ>" in the rules text; (2) occurrence_datetime - 3h
// (verified against ESPN scoreboards: NFL, EPL, NHL, WNBA all have occurrence_datetime = kickoff + 3h);
// (3) ticker yyMONddHHMM (ET). Events whose market closed before the start, or > 12h after, are dropped (cancelled/misdated).
export function startOf(ms) {
  const m0 = ms[0];
  let st = m0.rs ?? (m0.od ? Date.parse(m0.od) / 1000 - 3 * 3600 : null) ?? startFromTicker(m0.e);
  if (!st) return null;
  const ct = Date.parse(m0.ct) / 1000;
  if (ct < st + 600 || ct > st + 12 * 3600) return null;
  return st;
}
// Rate-limit budget: per-series event caps (systematic sample over time) and a priority order. Default cap 40.
const CAPS = { KXNFLGAME: 120, KXNHLGAME: 110, KXWNBAGAME: 130, KXNCAAFGAME: 200, KXMLSGAME: 80, KXEPLGAME: 60, KXUCLGAME: 60, KXUELGAME: 60, KXLALIGAGAME: 70, KXSERIEAGAME: 60, KXBUNDESLIGAGAME: 50, KXLIGUE1GAME: 50, KXUECLGAME: 70, KXATPMATCH: 150, KXWTAMATCH: 150, KXUFCFIGHT: 20, KXKHLGAME: 60, KXNPBGAME: 80, KXMLBGAME: 560, KXKBOGAME: 220 };
const PRIORITY = ["KXNFLGAME","KXNHLGAME","KXWNBAGAME","KXNCAAFGAME","KXEPLGAME","KXUCLGAME","KXUELGAME","KXLALIGAGAME","KXSERIEAGAME","KXBUNDESLIGAGAME","KXLIGUE1GAME","KXMLSGAME","KXUECLGAME","KXATPMATCH","KXWTAMATCH","KXUFCFIGHT","KXKHLGAME","KXNPBGAME","KXMLBGAME","KXKBOGAME"];
const rank = (k) => (PRIORITY.includes(k) ? PRIORITY.indexOf(k) : 999);
const SKIP_CANDLES = /^KX(CS2|LOL|VALORANT|ATPCHALLENGER|WTACHALLENGER|DARTS|TT|COD|T20|WT20|CLUBF|NCAAMSOCCER|NCAAWV|LMB|ODI|PREM)/;
const num = (x) => (x == null || x === "" ? null : +x);
async function candles(minEvents) {
  const en = rd("enumerated.json", {});
  const store = rd("candles.json", {}); const jobs = [];
  for (const [ser, d] of Object.entries(en).sort((x, y) => rank(x[0]) - rank(y[0]))) {
    const CAP = CAPS[ser] ?? 40;
    const byEv = {};
    for (const m of d.markets) (byEv[m.e] ||= []).push(m);
    const evs = Object.entries(byEv).filter(([e, ms]) => startOf(ms) && !SKIP_CANDLES.test(ser));
    if (evs.length < minEvents) continue;
    // cap per series (rate-limit budget): keep already-fetched events, then a systematic sample over time
    evs.sort((x, y) => startOf(x[1]) - startOf(y[1]));
    let sel = evs;
    if (evs.length > CAP) {
      const have = evs.filter(([, ms]) => ms[0].t in store), rest = evs.filter(([, ms]) => !(ms[0].t in store));
      const k = Math.max(0, CAP - have.length), step = rest.length / Math.max(1, k);
      sel = have.concat(k ? Array.from({ length: k }, (_, i) => rest[Math.floor(i * step)]) : []);
    }
    console.error("series", ser, sel.length, "of", evs.length, "events");
    for (const [e, ms] of sel) {
      const start = startOf(ms);
      // 2-way events: fetch one market only (the other is the complement); 3+ (soccer): fetch all
      for (const m of ms.length === 2 ? [ms[0]] : ms) if (!(m.t in store)) jobs.push({ t: m.t, start });
    }
  }
  // Batch tickers whose starts fall within 5h of each other into one request (the endpoint takes many tickers
  // with one shared time window); only candles in [start-75min, start+60s] are kept per ticker.
  jobs.sort((x, y) => x.start - y.start);
  let n = 0;
  for (let i = 0; i < jobs.length;) {
    const batch = [jobs[i]]; let k = i + 1;
    while (k < jobs.length && (batch.length + 1) * ((jobs[k].start - jobs[i].start) / 60 + 77) <= 8000 && batch.length < 40) batch.push(jobs[k++]);
    i = k;
    const j = await get(`${B}/markets/candlesticks?market_tickers=${batch.map((x) => x.t).join(",")}&start_ts=${batch[0].start - 75 * 60}&end_ts=${batch.at(-1).start + 60}&period_interval=1`);
    const st = Object.fromEntries(batch.map((x) => [x.t, x.start]));
    for (const mk of j.markets) {
      const s0 = st[mk.market_ticker];
      store[mk.market_ticker] = mk.candlesticks.filter((c) => c.end_period_ts >= s0 - 75 * 60 && c.end_period_ts <= s0 + 60)
        .map((c) => ({ t: c.end_period_ts, b: num(c.yes_bid?.close_dollars), a: num(c.yes_ask?.close_dollars), p: num(c.price?.close_dollars), v: num(c.volume_fp) }));
    }
    for (const x of batch) store[x.t] ||= [];
    if (++n % 10 === 0) { wr("candles.json", store); console.error("batches", n, "tickers", Object.keys(store).length, "left", jobs.length - i); }
  }
  wr("candles.json", store);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const st = process.argv[2];
  if (st === "enumerate") await enumerate();
  else if (st === "candles") await candles(+process.argv[3] || 30);
  else if (st === "analyze") (await import("./pregame-calibration-analyze.mjs")).run(CACHE, { startOf });
}
