/**
 * Bespoke evaluators: pure derivations (plus, for live-only data, a collect step) for rules the declarative
 * entry vocabulary cannot express. A hypothesis names one in `evaluator`.
 *
 *   evaluator = {
 *     needs:   what the evaluator reads, for status output
 *     collect: async ({h, store, fetcher, now, report}) -> void     optional; spends the request budget
 *     derive:  ({h, store, externalDir}) -> {items, notes}            items [{g, x, date, arm?}], pure over observations
 *   }
 *
 * `externalDir` holds raw files produced by the house's measuring scripts (combo-rigidity-measure --rows,
 * weather-totals-study rows); an evaluator whose file is absent reports `awaiting` and judges nothing.
 */
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { SPORTS, eventMatchesGame, normalizeScoreboard, sideMatches } from '../sport-feeds.mjs';
import { dtEntry, dtNet, isDeepTerminal, liveState } from '../forward-deep-terminal.mjs';
import { tradePnl } from '../venue-weather.mjs';
import { BudgetExhausted } from './fetcher.mjs';
import { RegistrationError, requireAfterRegistration } from './entry.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

async function* jsonlRows(file) {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line);
}
const listExternal = (dir, prefix) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')).sort().map((f) => join(dir, f)) : []);

// ------------------------------------------------------------------ deep-terminal (rule DT)
/**
 * DT needs game state while the game is live, which no archive holds: `collect` polls the ESPN scoreboards once
 * per call, and for each live NFL/NCAAF/MLB game in the deep-terminal cell with a qualifying favourite book it
 * stores one `dt-entry` fact (first qualifying poll per game). Results are looked up for entries awaiting one.
 */
async function collectDeepTerminal({ h, store, fetcher, now, report }) {
  const stamp = new Date(now).toISOString();
  try {
    for (const key of ['nfl', 'ncaaf', 'mlb']) {
      const spec = SPORTS[key], q = key === 'ncaaf' ? '?groups=80&limit=300' : '?limit=300';
      const sb = await fetcher.url(`${ESPN}/${spec.espn}/scoreboard${q}`);
      const raw = new Map((sb?.events ?? []).map((e) => [String(e.id), e]));
      for (const g of normalizeScoreboard('team', sb)) {
        if (g.state !== 'in') continue;
        const game = `${key}:${g.id}`;
        if (store.has(game, 'dt-entry')) continue;
        const st = liveState(key, raw.get(g.id));
        if (!isDeepTerminal(st)) continue;
        const events = (await fetcher.kalshi('/events', { series_ticker: spec.game, status: 'open', with_nested_markets: true, limit: 200 }))?.events ?? [];
        const ev = events.filter((e) => (e.markets ?? []).length === 2 && eventMatchesGame(e, g)).sort((a, b) => a.event_ticker.localeCompare(b.event_ticker))[0];
        if (!ev) continue;
        const team = st.teams[st.leader];
        const names = { names: [team.displayName, team.location, team.name, team.abbreviation, team.shortDisplayName, `${team.location ?? ''} ${team.name ?? ''}`.trim()].filter(Boolean) };
        const lm = ev.markets.filter((m) => sideMatches(m.yes_sub_title, names));
        if (lm.length !== 1) continue;
        const market = (await fetcher.kalshi(`/markets/${lm[0].ticker}`))?.market;
        if (!market) continue;
        const series = store.get(spec.game, 'series')?.multiplier ?? 1;
        const evFull = await fetcher.kalshi(`/events/${ev.event_ticker}`);
        const mult = evFull?.event?.fee_multiplier_override ?? evFull?.fee_multiplier_override ?? series;
        const e = dtEntry(market, mult);
        if (e.reason) continue;
        store.put(game, 'dt-entry', { game, sport: key, event: ev.event_ticker, ticker: e.ticker, price: e.price, fee: e.fee, at: stamp, slack: st.regime.slack, state: st.detail }, stamp);
        report.newEntries = (report.newEntries ?? 0) + 1;
      }
    }
    for (const [game, e] of store.all('dt-entry')) {
      if (store.has(game, 'dt-result')) continue;
      const market = (await fetcher.kalshi(`/markets/${e.ticker}`))?.market;
      if (market && (market.result === 'yes' || market.result === 'no')) store.put(game, 'dt-result', { result: market.result }, stamp);
    }
  } catch (error) { if (error instanceof BudgetExhausted) report.partial = true; else throw error; }
}

function deriveDeepTerminal({ h, store }) {
  const items = []; let refused = 0, pending = 0;
  for (const [game, e] of store.all('dt-entry')) {
    try { requireAfterRegistration(h, e.at, `dt-entry ${game}`); } catch (error) { if (error instanceof RegistrationError) { refused += 1; continue; } throw error; }
    const r = store.get(game, 'dt-result');
    if (!r) { pending += 1; continue; }
    items.push({ g: game, x: dtNet(e, r.result), date: e.at });
  }
  return { items: items.sort((a, b) => (a.g < b.g ? -1 : 1)), notes: { refused, pending } };
}

// ------------------------------------------------------------------ combo-flex (F1)
/**
 * F1 reads the priced-print rows of combo-rigidity-measure (`--rows combo-rows-<from>_<to>.jsonl`) for the
 * weekends in params.weekends. Maker P&L per print, clustered by game; arms by the pinned-interval width.
 */
async function deriveComboFlex({ h, externalDir }) {
  const { weekends, wideAbove, narrowAtMost } = h.params;
  const have = new Set(listExternal(externalDir, 'combo-rows-').map((f) => f.slice(f.lastIndexOf('combo-rows-') + 11, -6)));
  const files = listExternal(externalDir, 'combo-rows-').filter((f) => weekends.some(([a, b]) => f.endsWith(`combo-rows-${a}_${b}.jsonl`)));
  const missing = weekends.filter(([a, b]) => !have.has(`${a}_${b}`)).map(([a, b]) => `${a}_${b}`);
  const items = []; let refused = 0; const seen = new Set();
  for (const file of files) {
    for await (const r of jsonlRows(file)) {
      const day = new Date(r.at).toISOString().slice(0, 10);
      if (!weekends.some(([a, b]) => day >= a && day <= b)) continue;
      if (!(r.cluster && r.coherent) || r.outcome === null || r.outcome === undefined) continue;
      const at = new Date(r.at).toISOString();
      if (Date.parse(at) < Date.parse(h.registeredAt)) { refused += 1; continue; }
      const id = `${r.ticker}@${r.at}@${r.price}@${r.count}`;
      if (seen.has(id)) continue; seen.add(id);
      const width = r.pinned[1] - r.pinned[0], maker = r.taker === 'yes' ? r.price - r.outcome : r.outcome - r.price;
      items.push({ g: r.gameCodes[0], x: maker, date: at, arm: width > wideAbove ? 'wide' : width <= narrowAtMost ? 'narrow' : 'middle' });
    }
  }
  return { items, awaiting: missing.length ? `combo-rows-<weekend>.jsonl for ${missing.join(', ')} (combo-backfill then combo-rigidity-measure --rows)` : null, notes: { refused, files: files.length } };
}

// ------------------------------------------------------------------ weather totals rules R1-R4
const RULES = {
  R1: { side: 'NO', test: (f) => f.wind >= 15 || f.gust >= 25 },
  R2: { side: 'NO', test: (f) => f.temp <= 60 },
  R3: { side: 'YES', test: (f) => f.temp >= 85 },
  R4: { side: 'NO', test: (f) => f.precip >= 2 },
};
/** Reads weather-totals-study rows (`weather-totals-rows.jsonl`): one row per game, forecast window features and the 0.50 rung. */
async function deriveWeatherTotals({ h, externalDir }) {
  const { rule, sports } = h.params, R = RULES[rule], file = join(externalDir, 'weather-totals-rows.jsonl');
  if (!existsSync(file)) return { items: [], awaiting: 'weather-totals-rows.jsonl (weather-totals-study rows)', notes: {} };
  const items = []; let refused = 0;
  for await (const r of jsonlRows(file)) {
    if (r.roof || !sports.includes(r.sport) || !R.test(r.fc)) continue;
    const date = new Date(r.startMs).toISOString();
    if (Date.parse(date) < Date.parse(h.registeredAt)) { refused += 1; continue; }
    const t = tradePnl({ side: R.side, yesBid: r.rung.bid, yesAsk: r.rung.ask, resolvedYes: r.rung.yes });
    if (t) items.push({ g: r.event, x: t.net, date });
  }
  return { items, notes: { refused } };
}

export const EVALUATORS = Object.freeze({
  'deep-terminal': { needs: 'live ESPN scoreboards + Kalshi books (collect each cycle)', collect: collectDeepTerminal, derive: deriveDeepTerminal },
  'combo-flex': { needs: 'combo-rigidity-measure --rows files for the pre-registered weekends', derive: deriveComboFlex },
  'weather-totals-rule': { needs: 'weather-totals-study rows file (games after 2026-12-31)', derive: deriveWeatherTotals },
});
