#!/usr/bin/env node
// Weather vs Kalshi sports totals.  Public read-only data, never an order.
// Pre-registered rules and results: data/records/2026-10-07-weather-totals/README.md
//   node weather-totals-study.mjs espn|kalshi|match|geocode|wx|candles|analyze [--cache DIR]
// Pacing: Kalshi >= 450 ms, 429 -> wait 5-20 s, at most 5 consecutive then stop with partial results; other hosts >= 250 ms.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKalshiClient } from '../../../src/client.mjs';
import { parseTicker, impliedMedian, nearestRung, windowFeatures, olsCluster, tradePnl, meanSE } from '../src/venue-weather.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), cmd = argv[0];
const CACHE = argv.includes('--cache') ? argv[argv.indexOf('--cache') + 1] : '/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/wx-cache';
mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jread = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);

export const SPORTS = {
  nfl: { path: 'football/nfl', series: 'KXNFLTOTAL', from: '2026-08-28', to: '2026-10-06', hours: 3, extra: '' },
  ncaaf: { path: 'football/college-football', series: 'KXNCAAFTOTAL', from: '2026-08-28', to: '2026-10-06', hours: 3, extra: '&groups=80&limit=300' },
  mlb: { path: 'baseball/mlb', series: 'KXMLBTOTAL', from: '2026-07-01', to: '2026-10-06', hours: 2, extra: '' },
};
const MLB_ROOF = new Set(['HOU', 'ARI', 'AZ', 'MIA', 'MIL', 'SEA', 'TEX', 'TOR', 'TB']); // home-team abbreviations: retractable or fixed roof

async function plain(url) {
  for (let a = 0; a < 4; a++) {
    await sleep(250);
    const r = await fetch(url);
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error('retries exhausted ' + url);
}
function* days(a, b) { for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 86400000) yield new Date(t).toISOString().slice(0, 10); }

// ------------------------------------------------------------ espn
async function cmdEspn() {
  for (const [sp, S] of Object.entries(SPORTS)) {
    const f = join(CACHE, `espn-${sp}.json`), games = jread(f, {}), doneDays = new Set(jread(join(CACHE, `espn-${sp}.days.json`), []));
    for (const d of days(S.from, S.to)) {
      if (doneDays.has(d)) continue;
      const j = await plain(`https://site.api.espn.com/apis/site/v2/sports/${S.path}/scoreboard?dates=${d.replace(/-/g, '')}${S.extra}`);
      for (const e of j.events ?? []) {
        const c = e.competitions?.[0]; if (!c || e.status?.type?.name !== 'STATUS_FINAL') continue;
        const home = c.competitors.find((x) => x.homeAway === 'home'), away = c.competitors.find((x) => x.homeAway === 'away');
        const v = c.venue ?? {};
        games[e.id] = { id: e.id, sport: sp, startMs: Date.parse(e.date), home: home.team.abbreviation, away: away.team.abbreviation, homeName: home.team.displayName, awayName: away.team.displayName,
          hs: Number(home.score), as: Number(away.score), neutral: !!c.neutralSite, venueId: v.id ?? null, venue: v.fullName ?? null, city: v.address?.city ?? null, state: v.address?.state ?? null, country: v.address?.country ?? null, indoor: v.indoor ?? null };
      }
      doneDays.add(d); writeFileSync(f, JSON.stringify(games)); writeFileSync(join(CACHE, `espn-${sp}.days.json`), JSON.stringify([...doneDays]));
    }
    console.error(sp, Object.keys(games).length, 'final games');
  }
}

// ------------------------------------------------------------ kalshi
function makeGetter() {
  const client = createKalshiClient({ credentials: null, minIntervalMs: 450, retries429: 0 });
  let c429 = 0;
  return async (path, query) => {
    for (;;) {
      try { const r = await client.call('GET', path, { query, signed: false }); c429 = 0; return r; } catch (e) {
        if (e.code !== 'http-429') throw e;
        if (++c429 > 5) { const err = new Error('429 x5: stopping with partial results'); err.partial = true; throw err; }
        await sleep((5 + Math.random() * 15) * 1000);
      }
    }
  };
}
async function cmdKalshi() {
  const get = makeGetter();
  for (const [sp, S] of Object.entries(SPORTS)) {
    const f = join(CACHE, `kalshi-${sp}.json`); if (existsSync(f)) continue;
    const lo = Math.floor(Date.parse(S.from + 'T00:00:00Z') / 1000) - 86400, hi = Math.floor(Date.parse(S.to + 'T00:00:00Z') / 1000) + 3 * 86400;
    const out = []; let cursor;
    for (;;) {
      const d = await get('/markets', { series_ticker: S.series, status: 'settled', min_close_ts: lo, max_close_ts: hi, limit: 1000, cursor });
      for (const m of d.markets) if (m.result === 'yes' || m.result === 'no') out.push({ ticker: m.ticker, strike: m.floor_strike, yes: m.result === 'yes', total: Number(m.expiration_value), close: m.close_time, title: m.rules_primary });
      cursor = d.cursor; if (!cursor || !d.markets.length) break;
    }
    writeFileSync(f, JSON.stringify(out)); console.error(sp, out.length, 'markets');
  }
}

// ------------------------------------------------------------ match kalshi events to espn games
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function cmdMatch() {
  const res = {};
  for (const [sp] of Object.entries(SPORTS)) {
    const games = Object.values(jread(join(CACHE, `espn-${sp}.json`), {})), mk = jread(join(CACHE, `kalshi-${sp}.json`), []);
    const events = new Map();
    for (const m of mk) { const p = parseTicker(m.ticker); if (!p) continue; const e = events.get(p.event) ?? { ...p, markets: [], total: m.total, title: m.title }; e.markets.push({ ticker: m.ticker, strike: m.strike, yes: m.yes }); events.set(p.event, e); }
    const matched = []; let amb = 0, none = 0;
    for (const e of events.values()) {
      const dMs = Date.parse(e.date + 'T12:00:00Z');
      const cands = games.filter((g) => Math.abs(g.startMs - dMs) < 36 * 3600000 && g.hs + g.as === e.total);
      // ET calendar date of the start (UTC-4 in Aug-Oct, UTC-5 irrelevant) must equal the ticker date
      const sameDay = cands.filter((g) => new Date(g.startMs - 4 * 3600000).toISOString().slice(0, 10) === e.date);
      const scored = sameDay.map((g) => {
        const code = e.codes, a = norm(g.away), h = norm(g.home);
        let s = 0; if (code.endsWith(h)) s += 2; if (code.startsWith(a)) s += 2; if (code.includes(h)) s += 1; if (code.includes(a)) s += 1;
        const tm = /in the (.+?) vs\.? (.+?) (?:college|professional|Pro )/.exec(e.title ?? '');
        if (tm) { const A = norm(tm[1]), H = norm(tm[2]); if (norm(g.awayName).startsWith(A) || norm(g.awayName).includes(A)) s += 3; if (norm(g.homeName).startsWith(H) || norm(g.homeName).includes(H)) s += 3; }
        if (sp === 'mlb' && e.hhmm) { const et = new Date(g.startMs - 4 * 3600000).toISOString().slice(11, 16).replace(':', ''); if (et === e.hhmm) s += 3; }
        return { g, s };
      }).sort((x, y) => y.s - x.s);
      if (!scored.length) { none++; continue; }
      if (scored[0].s < 2 || (scored[1] && scored[1].s === scored[0].s)) { amb++; if (process.env.DBG && amb < 6) console.error(sp, e.event, e.total, e.title, scored.map((x) => x.g.awayName + '@' + x.g.homeName + ':' + x.s).join(' ; ')); continue; }
      matched.push({ event: e.event, espn: scored[0].g.id, markets: e.markets, total: e.total, date: e.date });
    }
    writeFileSync(join(CACHE, `match-${sp}.json`), JSON.stringify(matched));
    res[sp] = { events: events.size, matched: matched.length, ambiguous: amb, nocandidate: none };
  }
  console.error(JSON.stringify(res));
}

const matchedIds = (sp) => new Set(jread(join(CACHE, `match-${sp}.json`), []).map((m) => m.espn));
// ------------------------------------------------------------ geocode venues (Open-Meteo geocoding = GeoNames)
async function cmdGeocode() {
  const f = join(HERE, '../src/venue-coords.json'), table = jread(f, {});
  const venues = new Map();
  for (const sp of Object.keys(SPORTS)) for (const g of Object.values(jread(join(CACHE, `espn-${sp}.json`), {}))) {
    if (!matchedIds(sp).has(g.id)) continue;
    if (g.indoor || !g.venueId) continue;
    venues.set(`${sp}:${g.venueId}`, g);
  }
  for (const [k, g] of venues) {
    if (table[k]) continue;
    const q = encodeURIComponent(g.city ?? ''); if (!q) continue;
    const j = await plain(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=20&language=en`);
    const want = g.state, pick = (j.results ?? []).find((r) => r.country_code === 'US' && (r.admin1 === stateName(want) || r.admin1_id && false)) ?? (g.country && g.country !== 'USA' ? (j.results ?? [])[0] : null);
    table[k] = pick ? { venue: g.venue, city: g.city, state: g.state, lat: pick.latitude, lon: pick.longitude, src: 'open-meteo-geocoding(city)' } : { venue: g.venue, city: g.city, state: g.state, lat: null, lon: null };
  }
  writeFileSync(f, JSON.stringify(table, null, 1)); console.error(Object.keys(table).length, 'venues;', Object.values(table).filter((v) => v.lat == null).length, 'unresolved');
}
const ST = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
const stateName = (s) => ST[s] ?? s;


// ------------------------------------------------------------ weather: previous-day-1 forecast (tradable) + archive (sanity)
const UNITS = '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=mm&timezone=UTC';
async function cmdWx() {
  const coords = jread(join(HERE, '../src/venue-coords.json'), {}), need = new Map();
  for (const sp of Object.keys(SPORTS)) {
    const games = jread(join(CACHE, `espn-${sp}.json`), {});
    for (const m of jread(join(CACHE, `match-${sp}.json`), [])) {
      const g = games[m.espn], k = `${sp}:${g.venueId}`; if (g.indoor || !coords[k]) continue;
      const d = new Date(g.startMs).toISOString().slice(0, 10), e = new Date(g.startMs + 4 * 3600000).toISOString().slice(0, 10);
      const r = need.get(k) ?? { lo: d, hi: e }; if (d < r.lo) r.lo = d; if (e > r.hi) r.hi = e; need.set(k, r);
    }
  }
  const dir = join(CACHE, 'wx'); mkdirSync(dir, { recursive: true });
  for (const [k, r] of need) {
    const c = coords[k], f = join(dir, k.replace(':', '_') + '.json'); if (existsSync(f)) continue;
    const hi = r.hi > '2026-10-07' ? '2026-10-07' : r.hi, q = `latitude=${c.lat}&longitude=${c.lon}&start_date=${r.lo}&end_date=${hi}${UNITS}`;
    const V = ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation'];
    const prev = await plain(`https://previous-runs-api.open-meteo.com/v1/forecast?${q}&hourly=${V.map((v) => v + '_previous_day1').join(',')}`);
    const arch = await plain(`https://archive-api.open-meteo.com/v1/archive?${q}&hourly=${V.join(',')}`);
    const hf = (h, suf) => ({ time: h.time, temp: h['temperature_2m' + suf], wind: h['wind_speed_10m' + suf], gust: h['wind_gusts_10m' + suf], dir: h['wind_direction_10m' + suf], precip: h['precipitation' + suf] });
    writeFileSync(f, JSON.stringify({ fc: hf(prev.hourly, '_previous_day1'), ar: hf(arch.hourly, '') }));
  }
  console.error(need.size, 'venues weather');
}
// ------------------------------------------------------------ candles at start-60
async function cmdCandles() {
  const get = makeGetter();
  try {
    for (const sp of Object.keys(SPORTS)) {
      const games = jread(join(CACHE, `espn-${sp}.json`), {}), coords = jread(join(HERE, '../src/venue-coords.json'), {});
      const f = join(CACHE, `candles-${sp}.jsonl`), done = new Set(existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).event) : []);
      for (const m of jread(join(CACHE, `match-${sp}.json`), [])) {
        const g = games[m.espn]; if (g.indoor || done.has(m.event) || !coords[`${sp}:${g.venueId}`]) continue;
        if (sp === 'mlb' && MLB_ROOF.has(g.home)) { /* still fetched: sensitivity row */ }
        const t0 = Math.floor(g.startMs / 1000) - 3 * 3600, t1 = Math.floor(g.startMs / 1000) - 3600, rungs = {};
        for (let i = 0; i < m.markets.length; i += 60) {
          const grp = m.markets.slice(i, i + 60);
          const d = await get('/markets/candlesticks', { market_tickers: grp.map((x) => x.ticker).join(','), start_ts: t0, end_ts: t1, period_interval: 1 });
          for (const x of d.markets ?? []) {
            const cs = (x.candlesticks ?? []).filter((k) => k.end_period_ts <= t1);
            const q = cs.map((k) => [k.end_period_ts, Number(k.yes_bid?.close_dollars ?? 0), Number(k.yes_ask?.close_dollars ?? 0)]).filter((r) => r[1] > 0 && r[2] > 0 && r[2] <= 1);
            rungs[x.market_ticker] = q.length ? q[q.length - 1] : null;
          }
        }
        appendFileSync(f, JSON.stringify({ event: m.event, espn: m.espn, t1, rungs }) + '\n');
      }
      console.error(sp, 'candles done');
    }
  } catch (e) { if (e.partial) { console.error(e.message); process.exitCode = 3; } else throw e; }
}

// ------------------------------------------------------------ analyze
const FEAT = { wind: { src: 'wind', agg: 'mean' }, gust: { src: 'gust', agg: 'mean' }, temp: { src: 'temp', agg: 'mean' }, precip: { src: 'precip', agg: 'sum' } };
export function buildRows() {
  const coords = jread(join(HERE, '../src/venue-coords.json'), {}), rows = [], drops = {};
  for (const sp of Object.keys(SPORTS)) {
    const games = jread(join(CACHE, `espn-${sp}.json`), {}), match = new Map(jread(join(CACHE, `match-${sp}.json`), []).map((m) => [m.event, m]));
    const cf = join(CACHE, `candles-${sp}.jsonl`); if (!existsSync(cf)) continue;
    const dr = (drops[sp] = { matched: match.size, indoor: 0, noquote: 0, nomedian: 0, nowx: 0, used: 0 });
    for (const l of readFileSync(cf, 'utf8').split('\n').filter(Boolean)) {
      const c = JSON.parse(l), m = match.get(c.event), g = games[m.espn];
      if (g.indoor) { dr.indoor++; continue; }
      const rungs = m.markets.map((x) => ({ ticker: x.ticker, strike: x.strike, yes: x.yes, q: c.rungs[x.ticker] })).filter((x) => x.q && x.q[0] >= c.t1 - 3600 && x.q[1] < x.q[2])
        .map((x) => ({ ...x, bid: x.q[1], ask: x.q[2], mid: (x.q[1] + x.q[2]) / 2 }));
      if (rungs.length < 3) { dr.noquote++; continue; }
      const med = impliedMedian(rungs); if (med == null) { dr.nomedian++; continue; }
      const wx = jread(join(CACHE, 'wx', `${sp}_${g.venueId}.json`), null); if (!wx) { dr.nowx++; continue; }
      const nh = SPORTS[sp].hours, fc = windowFeatures({ ...wx.fc }, g.startMs, nh, FEAT), ar = windowFeatures({ ...wx.ar }, g.startMs, nh, FEAT);
      if (fc.wind == null || fc.temp == null) { dr.nowx++; continue; }
      const rung = nearestRung(rungs), total = g.hs + g.as;
      dr.used++;
      rows.push({ sport: sp, event: c.event, venueKey: `${sp}:${g.venueId}`, venue: g.venue, home: g.home, startMs: g.startMs, month: new Date(g.startMs).toISOString().slice(0, 7), total, med, resid: total - med,
        fc, ar, rung: { strike: rung.strike, bid: rung.bid, ask: rung.ask, yes: rung.yes }, roof: sp === 'mlb' && MLB_ROOF.has(g.home) });
    }
  }
  return { rows, drops };
}
const f2 = (x, d = 3) => (x == null ? 'NA' : x.toFixed(d));
function regTable(rows, specs, clusterBy) {
  const out = [];
  for (const [name, vars] of specs) {
    if (rows.length < 8) continue;
    const r = olsCluster(rows.map((x) => ({ y: x.resid, x: vars.map((v) => x.fc[v]), g: clusterBy(x) })));
    if (!r) continue;
    out.push(`| ${name} | ${r.n} | ${vars.map((v, i) => `${v} ${f2(r.b[i + 1])} (${f2(r.se[i + 1])}) t=${f2(r.t[i + 1], 2)}`).join('; ')} | ${f2(r.r2, 4)} |`);
  }
  return out;
}
const RULES = [
  { id: 'R1', sports: ['nfl', 'ncaaf', 'football'], side: 'NO', test: (f) => f.wind >= 15 || f.gust >= 25, desc: 'wind>=15 or gust>=25 mph -> NO' },
  { id: 'R2', sports: ['mlb'], side: 'NO', test: (f) => f.temp <= 60, desc: 'temp<=60F -> NO' },
  { id: 'R3', sports: ['mlb'], side: 'YES', test: (f) => f.temp >= 85, desc: 'temp>=85F -> YES' },
  { id: 'R4', sports: ['nfl', 'ncaaf', 'football', 'mlb'], side: 'NO', test: (f) => f.precip >= 2, desc: 'precip>=2mm -> NO' },
];
function trades(rows, rule, sport, all = false) {
  const sel = rows.filter((r) => (sport === 'football' ? r.sport !== 'mlb' : r.sport === sport) && (all || rule.test(r.fc)));
  return sel.map((r) => ({ r, t: tradePnl({ side: rule.side, yesBid: r.rung.bid, yesAsk: r.rung.ask, resolvedYes: r.rung.yes }) })).filter((x) => x.t);
}
const cell = (v) => { const m = meanSE(v); return m.n ? `${m.n} / ${f2(m.mean)} (${f2(m.se)})` : '0'; };
function ruleTable(rows, sport, rule) {
  const T = trades(rows, rule, sport), B = trades(rows, rule, sport, true), months = [...new Set(rows.map((r) => r.month))].sort();
  const line = (x, lab) => `| ${rule.id} ${sport} | ${lab} | ${cell(x.map((y) => y.t.net))} | ${cell(x.map((y) => y.t.gross))} | ${f2(meanSE(x.map((y) => y.t.ask)).mean, 2)} |`;
  const out = [line(T, 'all (pooled)')];
  const withTrades = months.filter((m) => T.some((x) => x.r.month === m));
  let hold = withTrades.slice(-1);
  if (hold.length && T.filter((x) => x.r.month === hold[0]).length < 10 && withTrades.length > 1) hold = withTrades.slice(-2);
  const tr = withTrades.filter((m) => !hold.includes(m));
  out.push(line(T.filter((x) => hold.includes(x.r.month)), `holdout (${hold.join('+') || '-'})`), line(T.filter((x) => tr.includes(x.r.month)), `train (${tr.join('+') || '-'})`));
  for (const m of months) out.push(line(T.filter((x) => x.r.month === m), m));
  out.push(line(B, `baseline: same ${rule.side} rung rule, ALL games`));
  return out;
}
function cmdAnalyze() {
  const { rows: all, drops } = buildRows(); const out = [];
  out.push('### Sample\n', '```', JSON.stringify(drops), '```');
  const prim = all.filter((r) => !r.roof);
  const clG = (x) => x.event, clV = (x) => x.venueKey;
  const SPECS = [['multi', ['wind', 'gust', 'precip', 'temp']], ['wind', ['wind']], ['gust', ['gust']], ['precip', ['precip']], ['temp', ['temp']]];
  for (const [label, set] of [['nfl', prim.filter((r) => r.sport === 'nfl')], ['ncaaf', prim.filter((r) => r.sport === 'ncaaf')], ['football', prim.filter((r) => r.sport !== 'mlb')], ['mlb', prim.filter((r) => r.sport === 'mlb')], ['mlb incl roof parks', all.filter((r) => r.sport === 'mlb')]]) {
    if (set.length < 8) continue;
    const vs = set.map((r) => r.resid); const m = meanSE(vs);
    out.push(`\n#### Regression ${label}: n=${set.length} games, mean resid ${f2(m.mean)} (SE ${f2(m.se)}), sd ${f2(Math.sqrt(vs.reduce((s, x) => s + (x - m.mean) ** 2, 0) / (vs.length - 1)))}\n`, '| spec | n | coefficients (SE, game-clustered) | R2 |', '|---|---|---|---|', ...regTable(set, SPECS, clG));
    out.push('', 'venue-clustered:', '| spec | n | coefficients (SE) | R2 |', '|---|---|---|---|', ...regTable(set, SPECS.slice(0, 2), clV));
    const cr = (a) => { const x = set.map((r) => r.fc[a]), y = set.map((r) => r.ar[a]), mx = meanSE(x).mean, my = meanSE(y).mean; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
    const arset = set.filter((r) => r.ar.wind != null);
    const rowsA = arset.map((r) => ({ ...r, fc: r.ar }));
    out.push('', `forecast-vs-archive corr: wind ${f2(cr('wind'), 2)}, temp ${f2(cr('temp'), 2)}; archive-feature sanity regression:`, '| spec | n | coefficients | R2 |', '|---|---|---|---|', ...regTable(rowsA, SPECS.slice(0, 2), clG));
  }
  out.push('\n### Rules (cell = n / mean net P&L per contract (SE))\n', '| rule | slice | net | gross | mean ask |', '|---|---|---|---|---|');
  for (const rule of RULES) for (const sp of rule.sports) out.push(...ruleTable(prim, sp, rule));
  out.push('\n### Sensitivity: MLB including roof parks (R2,R3 pooled)\n', '| rule | slice | net | gross | mean ask |', '|---|---|---|---|---|');
  for (const rule of RULES.filter((r) => r.sports.includes('mlb'))) out.push(ruleTable(all, 'mlb', rule)[0]);
  out.push('\nFeature distribution (forecast window): ' + ['nfl', 'ncaaf', 'mlb'].map((sp) => { const set = prim.filter((r) => r.sport === sp); const q = (k, p) => set.map((r) => r.fc[k]).sort((a, b) => a - b)[Math.floor(p * (set.length - 1))]; return `${sp}: wind p50 ${f2(q('wind', .5), 1)} p90 ${f2(q('wind', .9), 1)}, gust p90 ${f2(q('gust', .9), 1)}, temp p10 ${f2(q('temp', .1), 0)} p90 ${f2(q('temp', .9), 0)}, precip>=2mm ${set.filter((r) => r.fc.precip >= 2).length}`; }).join(' | '));
  console.log(out.join('\n'));
}

const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const run = { espn: cmdEspn, kalshi: cmdKalshi, match: cmdMatch, geocode: cmdGeocode, wx: cmdWx, candles: cmdCandles, analyze: cmdAnalyze };
if (import.meta.url === `file://${process.argv[1]}` && run[cmd]) {
  try { await run[cmd](); } catch (e) { if (e.partial) { console.error(e.message); process.exitCode = 3; } else throw e; }
}
