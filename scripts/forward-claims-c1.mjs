#!/usr/bin/env node
/**
 * Forward test of pre-registered rule C1 (weekly jobless claims). Shadow only, public GETs, >= 400 ms pacing.
 *
 *   node scripts/forward-claims-c1.mjs cycle   idempotent; safe every 15-60 min
 *   node scripts/forward-claims-c1.mjs score   verdict status
 *
 * State (append-only JSONL): ~/.local/state/561-group/settlements/forecasting-service/forward/claims-c1/log.jsonl
 *   {type:'snapshot', event_ticker, kind:'window'|'late', hours_to_close, at, close_time, fee_multiplier, entries:[...]}
 *   {type:'result', event_ticker, ticker, result, at}
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KALSHI, appendJsonl, jackknife, pacedGet, readJsonl, stateDir, verdict } from '../src/forward-shadow.mjs';
import { c1Entries, hoursToClose, scoreItems, snapshotKind } from '../src/forward-claims-c1.mjs';

const SERIES = 'KXJOBLESSCLAIMS';
const LOG = join(stateDir('claims-c1'), 'log.jsonl');

export async function forwardClaimsCycle() {
  const now = Date.now(); const rows = readJsonl(LOG);
  const recorded = new Set(rows.filter((r) => r.type === 'snapshot').map((r) => r.event_ticker));
  const resolved = new Set(rows.filter((r) => r.type === 'result').map((r) => r.ticker));
  const out = [];
  const open = (await pacedGet(`${KALSHI}/markets?series_ticker=${SERIES}&status=open&limit=1000`))?.markets ?? [];
  const byEvent = new Map();
  for (const m of open) { if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, []); byEvent.get(m.event_ticker).push(m); }
  let mult = null;
  for (const [ev, ms] of byEvent) {
    const hours = hoursToClose(ms[0].close_time, now);
    const kind = snapshotKind(hours, recorded.has(ev));
    console.log(`${ev}: ${hours === null ? '?' : hours.toFixed(1)} h to close, ${recorded.has(ev) ? 'recorded' : kind ? `snapshot (${kind})` : 'waiting'}`);
    if (!kind) continue;
    mult ??= (await pacedGet(`${KALSHI}/series/${SERIES}`))?.series?.fee_multiplier ?? 1;
    out.push({ type: 'snapshot', event_ticker: ev, kind, hours_to_close: Math.round(hours * 100) / 100, at: new Date(now).toISOString(), close_time: ms[0].close_time, fee_multiplier: mult, n_markets: ms.length, entries: c1Entries(ms, mult) });
    console.log(`  recorded ${out.at(-1).entries.length} C1 entries of ${ms.length} markets`);
  }
  // results for recorded events whose markets have closed
  const pending = rows.filter((r) => r.type === 'snapshot').flatMap((s) => s.entries.map((e) => ({ ev: s.event_ticker, ticker: e.ticker }))).filter((p) => !resolved.has(p.ticker));
  for (const ev of new Set(pending.map((p) => p.ev))) {
    const ms = (await pacedGet(`${KALSHI}/markets?event_ticker=${ev}&limit=1000`))?.markets ?? [];
    for (const m of ms) {
      if ((m.result === 'yes' || m.result === 'no') && pending.some((p) => p.ticker === m.ticker)) {
        out.push({ type: 'result', event_ticker: ev, ticker: m.ticker, result: m.result, at: new Date().toISOString() });
        console.log(`  result ${m.ticker} ${m.result}`);
      }
    }
  }
  appendJsonl(LOG, out);
  console.log(`cycle done: ${out.length} rows appended`);
  return { program: 'claims-c1', at: new Date(now).toISOString(), snapshots: out.filter((r) => r.type === 'snapshot').length, results: out.filter((r) => r.type === 'result').length, orderEffect: false };
}

export function forwardClaimsScore() {
  const rows = readJsonl(LOG); const { items, late, pending } = scoreItems(rows);
  const st = jackknife(items); const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
  const snaps = rows.filter((r) => r.type === 'snapshot');
  console.log(`C1 forward test (pre-registered: >= 12 new events, mean net > 0, t > 2, delete-one-event jackknife)`);
  console.log(`snapshots: ${snaps.length} (${snaps.filter((s) => s.kind === 'window').length} in the 23-25 h window, ${snaps.filter((s) => s.kind === 'late').length} late and excluded from the verdict)`);
  console.log(`scored events ${st.groups}, contracts-orders ${st.n}, pending entries ${pending}`);
  console.log(`mean net/contract ${f(st.mean)}  SE ${f(st.se)}  t ${f(st.t, 2)}`);
  if (late.length) { const l = jackknife(late); console.log(`late snapshots (informational): events ${l.groups}, orders ${l.n}, mean ${f(l.mean)}`); }
  console.log(`verdict: ${verdict(st, 12)}`);
  return { program: 'claims-c1', snapshots: snaps.length, inWindowSnapshots: snaps.filter((s) => s.kind === 'window').length, pending, statistics: st, verdict: verdict(st, 12), orderEffect: false };
}


// Importable by the host's typed operation registry without starting any cycle at module load.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'cycle') forwardClaimsCycle().catch((e) => { console.error(e.message); process.exitCode = 1; });
  else if (cmd === 'score') forwardClaimsScore();
  else { console.error('usage: forward-claims-c1.mjs cycle|score'); process.exitCode = 2; }
}
