/**
 * The Kalshi combo (parlay) RFQ market presented by its rules (gaming faculty `gameRules`), the
 * concurrent game beside the order-book arena (`../../src/arena.mjs`).
 *
 * Units as there: prices are integer ten-thousandths of a dollar (ONE per dollar), quantities integer
 * hundredths of a contract, so replay is exact. A position is JSON-safe (plain objects and arrays, no
 * Maps), so `hashPosition` content-addresses it directly and no `serialize` is declared:
 *   { books: {legTicker: {event, bid, ask, t}}, rfqs: {id: {ticker, legs, at, status}},
 *     quotes: {rfqId: {price, side}}, prints: [...], fills: [...], results: {ticker: 0|1}, seq }
 * A requester asks for a price on a combo; we are a maker. Moves (`kind`):
 *   book    Opponent (nature of the leg markets): a leg's top of book; enabled when `t` is not earlier
 *           than that ticker's last book.
 *   rfq     Opponent (a requester): enabled when `id` is new.
 *   quote   Player (our maker design): sell YES of the rfq's combo at `price`; enabled when the rfq exists,
 *           is open, and we have not quoted it.
 *   print   Opponent: the rfq executed on the combo tape; closes every open rfq on that ticker. A quote at
 *           or under the print price, when the taker bought YES, was the cheapest seller: a SHADOW fill is
 *           recorded (never a real one).
 *   settle  nature: a leg or combo ticker's result, enabled once per ticker.
 * `extend` throws on a move not enabled, so a play (a sequence of legal extensions) is replayable by
 * `replayPlay(comboArena, seed, moves)` and verifiable by `playVerifier(comboArena)` (sealed arrival =
 * replay). A strategy is a design: a function from (position, rfq) to the Player's next move or null; its
 * play is the recorded tape interleaved with its quotes, which `playStrategy` produces.
 */
import { gameRules, hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { parlayInterval } from './combo-rigidity.mjs';
import { legMeta } from './combo-pricer.mjs';

export const ONE = 10000; // a dollar, the payout of one contract, in price units

export const initialPosition = () => ({ books: {}, rfqs: {}, quotes: {}, prints: [], fills: [], results: {}, seq: 0 });

const isInt = (x) => Number.isSafeInteger(x);
const need = (ok, msg) => { if (!ok) throw new RangeError(msg); };
const unit = (p, what) => need(isInt(p) && p >= 0 && p <= ONE, `${what} ${p} is not an integer price in [0, ${ONE}]`);

/** The legal extension x -> x + {move}; throws on a move not enabled at x. */
export function extend(position, move) {
  const next = (patch, events) => ({ state: { ...position, ...patch, seq: position.seq + 1 }, events });
  switch (move?.kind) {
    case 'book': {
      for (const k of ['bid', 'ask']) if (move[k] !== null) unit(move[k], k);
      need(isInt(move.t), `book t ${move.t} is not an integer`);
      const prev = position.books[move.ticker];
      need(!prev || move.t >= prev.t, `stale book for ${move.ticker}: ${move.t} < ${prev?.t}`);
      return next({ books: { ...position.books, [move.ticker]: { event: move.event, bid: move.bid, ask: move.ask, t: move.t } } }, [{ kind: 'book', polarity: 'O', ticker: move.ticker, t: move.t }]);
    }
    case 'rfq': {
      need(typeof move.id === 'string' && move.id !== '' && !(move.id in position.rfqs), `rfq ${move.id} is not new`);
      need(Array.isArray(move.legs) && move.legs.length > 0, `rfq ${move.id} has no legs`);
      return next({ rfqs: { ...position.rfqs, [move.id]: { ticker: move.ticker, legs: move.legs, at: move.at, status: 'open' } } }, [{ kind: 'rfq', polarity: 'O', id: move.id, ticker: move.ticker }]);
    }
    case 'quote': {
      const r = position.rfqs[move.rfqId];
      need(r, `quote on unknown rfq ${move.rfqId}`);
      need(r.status === 'open', `rfq ${move.rfqId} is ${r.status}`);
      need(!(move.rfqId in position.quotes), `rfq ${move.rfqId} already quoted`);
      unit(move.price, 'quote price');
      return next({ quotes: { ...position.quotes, [move.rfqId]: { price: move.price, side: 'yes' } } }, [{ kind: 'quote', polarity: 'P', rfqId: move.rfqId, price: move.price }]);
    }
    case 'print': {
      unit(move.price, 'print price');
      need(isInt(move.count) && move.count > 0, `print count ${move.count} is not a positive integer`);
      need(move.taker === 'yes' || move.taker === 'no', `print taker ${move.taker}`);
      const rfqs = { ...position.rfqs }; const fills = []; const events = [{ kind: 'print', polarity: 'O', ticker: move.ticker, price: move.price }];
      for (const [id, r] of Object.entries(position.rfqs)) {
        if (r.ticker !== move.ticker || r.status !== 'open') continue;
        rfqs[id] = { ...r, status: 'closed' };
        const q = position.quotes[id];
        if (q && move.taker === 'yes' && q.price <= move.price) { fills.push({ rfqId: id, ticker: move.ticker, price: q.price, count: move.count, at: move.at, shadow: true }); events.push({ kind: 'shadow-fill', polarity: 'N', rfqId: id, price: q.price }); }
      }
      return next({ rfqs, prints: [...position.prints, { ticker: move.ticker, price: move.price, count: move.count, taker: move.taker, at: move.at }], fills: [...position.fills, ...fills] }, events);
    }
    case 'settle': {
      need(move.result === 0 || move.result === 1, `settle result ${move.result}`);
      need(!(move.ticker in position.results), `${move.ticker} already settled`);
      return next({ results: { ...position.results, [move.ticker]: move.result } }, [{ kind: 'settle', polarity: 'N', ticker: move.ticker, result: move.result }]);
    }
    default: throw new TypeError(`extend: unknown move kind ${move?.kind}`);
  }
}

export const comboArena = gameRules(initialPosition, extend);

const EPS = 1e-9;
/** Books of a position as parlayInterval wants them: Map game -> [{ticker, event, bid, ask}] in dollars. */
export function booksByGame(position) {
  const out = new Map();
  for (const [ticker, b] of Object.entries(position.books)) {
    const game = legMeta(ticker, b.event).game;
    (out.get(game) ?? out.set(game, []).get(game)).push({ ticker, event: b.event, bid: b.bid === null ? null : b.bid / ONE, ask: b.ask === null ? null : b.ask / ONE });
  }
  return out;
}

/** Strategy: quote ceil(pinned hi + edge) units (YES sold) when the legs' books admit a measure, else pass. */
export const rigidityMaker = ({ edge = 0 } = {}) => (position, rfq) => {
  const iv = parlayInterval(rfq.legs, booksByGame(position));
  if (!iv.coherent) return null;
  const price = Math.min(ONE, Math.max(0, Math.ceil(iv.pinned[1] * ONE - EPS + edge)));
  return { kind: 'quote', rfqId: rfq.id, price };
};

/** Shadow P&L per fill whose combo has settled (the combo ticker, else every leg): units per contract
 *  (`pnl` = price - outcome*ONE, we sold YES) and `total` = pnl * count / 100 in units. */
export function pnlOf(position) {
  const out = [];
  for (const f of position.fills) {
    const legs = position.rfqs[f.rfqId].legs;
    let outcome = position.results[f.ticker];
    if (outcome === undefined && legs.every((l) => l.ticker in position.results)) outcome = legs.every((l) => (l.side === 'yes' ? position.results[l.ticker] : 1 - position.results[l.ticker]) === 1) ? 1 : 0;
    if (outcome === undefined) continue;
    const pnl = f.price - outcome * ONE;
    out.push({ rfqId: f.rfqId, ticker: f.ticker, price: f.price, count: f.count, outcome, pnl, total: pnl * f.count / 100 });
  }
  return out;
}

/** Play a strategy against a recorded tape of Opponent/nature moves: after each `rfq` the strategy is
 *  asked, and its quote (if any) is admitted next. Returns the whole play, the position, its hash. */
export function playStrategy(tape, strategy, seed) {
  let position = comboArena.initialPosition(seed); const moves = [];
  const admit = (m) => { position = comboArena.extend(position, m).state; moves.push(m); };
  for (const m of tape) {
    admit(m);
    if (m.kind !== 'rfq') continue;
    const q = strategy(position, { id: m.id, ...position.rfqs[m.id] });
    if (q) admit(q);
  }
  return { moves, position, positionHash: hashPosition(comboArena.serialize(position)) };
}
