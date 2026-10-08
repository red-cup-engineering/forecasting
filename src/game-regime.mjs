/**
 * Game regime from play-by-play state, pure.
 *
 * Obsmetrologia reading: between scores a live game-winner contract is a smooth flow; a score is a firing
 * singularity. Once no firing the trailer can reach in the time left could change the settled outcome, the
 * game is in the terminal smooth regime (`smooth_is_terminal`). This module measures reachability and labels it.
 *
 * Rule (deliberately simple, trailer-friendly so "terminal" is conservative):
 *
 *   football (NFL, NCAAF; 4 x 900 s; margin = leader's lead in points)
 *     needed    = ceil(margin / 8)           trailer scoring possessions to force a tie (TD + 2pt = 8)
 *     available = floor(secondsLeft / 150) + (trailer may hold the ball now ? 1 : 0)
 *                                            one trailer possession per 150 s of remaining clock, plus the one in hand
 *                                            (possession unknown counts as the trailer's)
 *   baseball (MLB; 9 innings; margin = leader's lead in runs)
 *     needed    = margin                     runs to tie
 *     available = outs the trailing offence still has in regulation (1 run per out)
 *
 *   regime = 'terminal'  when needed > available            (no reachable firing set changes the outcome)
 *          = 'early'     when not terminal and the game is in its first half
 *                        (football: > 1800 s left, i.e. Q1-Q2; MLB: innings 1-4)
 *          = 'contested' otherwise (including tied games and overtime / extra innings)
 *
 * slack = available - needed (negative = terminal). Regulation only: overtime and extra innings are 'contested'.
 */
export const FOOTBALL_PERIOD_SEC = 900;
export const FOOTBALL_SEC_PER_POSSESSION = 150;
export const FOOTBALL_FIRING_POINTS = 8;

const FOOTBALL = new Set(['nfl', 'ncaaf']);

/** Seconds left in regulation, or null in overtime. */
export function footballSecondsLeft(period, clockSec) {
  if (!(period >= 1) || period > 4) return null;
  return (4 - period) * FOOTBALL_PERIOD_SEC + Math.max(0, Math.min(FOOTBALL_PERIOD_SEC, clockSec));
}

/** Outs the trailing team's offence still has in a 9-inning game; `half` is 'top' | 'bottom'. outs 3 = half just ended. */
export function baseballTrailerOuts(inning, half, outs, trailerIsAway) {
  const o = Math.min(3, Math.max(0, outs ?? 0));
  const inHalf = half === 'top';
  if (inning > 9) return null;
  // half-innings of the trailer's own still to bat, counting the current one when it is the trailer's half
  if (trailerIsAway) return inHalf ? (3 - o) + 3 * (9 - inning) : 3 * (9 - inning);
  return inHalf ? 3 * (10 - inning) : (3 - o) + 3 * (9 - inning);
}

/**
 * @param {object} s  { sport: 'nfl'|'ncaaf'|'mlb', margin (>=0, leader's lead),
 *   football: period, clockSec, trailerHasBall (true|false|undefined=unknown),
 *   mlb: inning, half ('top'|'bottom'), outs, trailerIsAway }
 * @returns {{regime: 'terminal'|'contested'|'early', needed: number, available: number, slack: number}}
 */
export function gameRegime(s) {
  const margin = Math.max(0, Number(s.margin) || 0);
  if (FOOTBALL.has(s.sport)) {
    const sec = footballSecondsLeft(s.period, s.clockSec);
    if (sec === null) return { regime: 'contested', needed: Math.ceil(margin / FOOTBALL_FIRING_POINTS), available: Infinity, slack: Infinity };
    const needed = Math.ceil(margin / FOOTBALL_FIRING_POINTS);
    const available = Math.floor(sec / FOOTBALL_SEC_PER_POSSESSION) + (s.trailerHasBall === false ? 0 : 1);
    return label(needed, available, sec > 2 * FOOTBALL_PERIOD_SEC);
  }
  if (s.sport === 'mlb') {
    if (!(s.inning >= 1) || s.inning > 9) return { regime: 'contested', needed: margin, available: Infinity, slack: Infinity };
    const available = baseballTrailerOuts(s.inning, s.half, s.outs, Boolean(s.trailerIsAway));
    return label(margin, available, s.inning <= 4);
  }
  throw new Error(`gameRegime: unknown sport ${s.sport}`);
}

function label(needed, available, early) {
  const slack = available - needed;
  // a tied game has needed 0: never terminal (slack >= 0 unless no time is left at all)
  const regime = needed > available ? 'terminal' : early ? 'early' : 'contested';
  return { regime, needed, available, slack };
}
