/**
 * Rule DT (pre-registered in data/records/2026-10-07-inplay-regime/README.md): buy the favourite at the ask when
 * ask in [0.90, 0.985] and the game is terminal with slack <= -2 (NFL, NCAAF, MLB). Pure decision functions that turn
 * an ESPN scoreboard game (live) into the gameRegime input and a Kalshi market into an entry.
 */
import { gameRegime } from './game-regime.mjs';
import { num } from './forward-shadow.mjs';

export const DT = { askLo: 0.90, askHi: 0.985, maxSlack: -2, maxSpread: 0.10, minGames: 60 };

const clockToSec = (s) => { const m = /^(\d+):(\d+)/u.exec(s ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/**
 * Raw ESPN scoreboard event JSON (live) -> { sport-neutral state } or null. `ev.competitions[0]` carries status, situation
 * and competitors; scores are strings.
 */
export function liveState(sport, ev) {
  const c = ev?.competitions?.[0]; if (!c || c.status?.type?.state !== 'in') return null;
  const home = c.competitors.find((t) => t.homeAway === 'home'); const away = c.competitors.find((t) => t.homeAway === 'away');
  if (!home || !away) return null;
  const h = Number(home.score); const a = Number(away.score); if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const leader = h === a ? null : h > a ? 'home' : 'away'; const trailer = leader === 'home' ? 'away' : 'home';
  const base = { id: String(ev.id), home: h, away: a, leader, margin: Math.abs(h - a), teams: { home: home.team, away: away.team }, teamIds: { home: String(home.team.id), away: String(away.team.id) } };
  if (sport === 'mlb') {
    const detail = c.status?.type?.detail ?? c.status?.type?.shortDetail ?? '';
    const m = /^(Top|Bot|Bottom|Mid|Middle|End)\s+(?:of\s+the\s+)?(\d+)/iu.exec(detail); if (!m) return null;
    let inning = Number(m[2]); let half; let outs = c.situation?.outs ?? 0; const kind = m[1].toLowerCase();
    if (kind === 'top') half = 'top'; else if (kind.startsWith('bot')) half = 'bottom';
    else if (kind.startsWith('mid')) { half = 'bottom'; outs = 0; } else { half = 'top'; inning += 1; outs = 0; }
    if (outs >= 3) { if (half === 'top') half = 'bottom'; else { half = 'top'; inning += 1; } outs = 0; }
    return { ...base, regime: gameRegime({ sport, inning, half, outs, margin: base.margin, trailerIsAway: trailer === 'away' }), detail: `${half} ${inning} ${outs} out` };
  }
  const pos = c.situation?.possession != null ? String(c.situation.possession) : null;
  const hasBall = leader === null || pos === null ? undefined : pos === base.teamIds[trailer];
  const clockSec = Number.isFinite(c.status.clock) && c.status.clock > 0 ? c.status.clock : clockToSec(c.status.displayClock);
  return { ...base, regime: gameRegime({ sport, period: c.status.period, clockSec, margin: base.margin, trailerHasBall: hasBall }), detail: `P${c.status.period} ${c.status.displayClock} ${hasBall === undefined ? 'ball?' : hasBall ? 'trailer ball' : 'leader ball'}` };
}

/** Is the game in the pre-registered deep-terminal cell? Needs a leader, terminal, finite slack <= -2. */
export const isDeepTerminal = (st) => Boolean(st && st.leader && st.regime.regime === 'terminal' && Number.isFinite(st.regime.slack) && st.regime.slack <= DT.maxSlack);

/** Entry from the leader's Kalshi market (yes side = leader), or { reason } when the book does not qualify. */
export function dtEntry(market, mult) {
  const bid = num(market.yes_bid_dollars); const ask = num(market.yes_ask_dollars);
  if (bid === null || ask === null) return { reason: 'no quote' };
  if (!(bid > 0 && ask < 1)) return { reason: 'one-sided book' };
  if (ask - bid > DT.maxSpread) return { reason: 'spread' };
  if ((bid + ask) / 2 < 0.5) return { reason: 'leader not favourite' };
  if (!(ask >= DT.askLo && ask <= DT.askHi)) return { reason: `ask ${ask} outside band` };
  return { ticker: market.ticker, yes_bid: bid, yes_ask: ask, yes_bid_size: num(market.yes_bid_size_fp), yes_ask_size: num(market.yes_ask_size_fp), price: ask, fee_multiplier: mult, fee: 0.07 * mult * ask * (1 - ask) };
}

/** Net P&L per contract: unrounded fee, as in the study. */
export const dtNet = (e, result) => (result === 'yes' ? 1 : 0) - e.price - e.fee;
