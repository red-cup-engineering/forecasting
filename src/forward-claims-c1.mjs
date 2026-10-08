/**
 * Rule C1 (pre-registered in data/records/2026-10-07-econ-ladders/README.md): for each KXJOBLESSCLAIMS event, 24 h
 * before close, for every threshold market whose YES ask lies in [0.15, 0.65], buy NO at 1 - bid (C = 10 order, taker
 * fee cent-rounded per order), hold to settlement. Pure decision functions.
 */
import { num, orderFee } from './forward-shadow.mjs';

export const C1 = { askLo: 0.15, askHi: 0.65, count: 10, targetH: 24, windowLo: 23, windowHi: 25 };

/** Hours to close; null when unparsable. */
export const hoursToClose = (closeIso, nowMs) => { const t = Date.parse(closeIso); return Number.isFinite(t) ? (t - nowMs) / 3600e3 : null; };

/**
 * Should this event be snapshotted now?  'window' inside 23-25 h; 'late' when the window passed unrecorded and the
 * market is still open (closest available snapshot, flagged, excluded from the verdict); otherwise null.
 */
export function snapshotKind(hours, alreadyRecorded) {
  if (alreadyRecorded || hours === null || hours <= 0) return null;
  if (hours >= C1.windowLo && hours <= C1.windowHi) return 'window';
  if (hours < C1.windowLo) return 'late';
  return null;
}

/** C1 entries from a list of Kalshi market objects (live GET /markets payload) and the series fee multiplier. */
export function c1Entries(markets, mult) {
  const out = [];
  for (const m of markets) {
    const ask = num(m.yes_ask_dollars); const bid = num(m.yes_bid_dollars);
    if (ask === null || bid === null || !(ask >= C1.askLo && ask <= C1.askHi)) continue;
    const noPrice = Math.round((1 - bid) * 1e4) / 1e4; // buy NO at 1 - yes bid
    const fee = orderFee(mult, noPrice, C1.count);
    out.push({
      ticker: m.ticker, strike: m.floor_strike ?? m.cap_strike ?? null, strike_type: m.strike_type ?? null,
      yes_bid: bid, yes_ask: ask, yes_bid_size: num(m.yes_bid_size_fp), yes_ask_size: num(m.yes_ask_size_fp),
      no_price: noPrice, count: C1.count, fee_order: fee, fee_per_contract: fee / C1.count,
    });
  }
  return out;
}

/** Net P&L per contract of one entry given the market result ('yes' | 'no'). */
export const entryNet = (e, result) => (result === 'no' ? 1 : 0) - e.no_price - e.fee_per_contract;

/** Fold the JSONL log into scorable items. Only 'window' snapshots count toward the verdict. */
export function scoreItems(rows) {
  const results = new Map(rows.filter((r) => r.type === 'result').map((r) => [r.ticker, r.result]));
  const items = []; const late = []; let pending = 0;
  for (const s of rows.filter((r) => r.type === 'snapshot')) {
    for (const e of s.entries) {
      const res = results.get(e.ticker);
      if (res !== 'yes' && res !== 'no') { if (s.kind === 'window') pending += 1; continue; }
      (s.kind === 'window' ? items : late).push({ g: s.event_ticker, x: entryNet(e, res) });
    }
  }
  return { items, late, pending };
}
