import test from 'node:test';
import assert from 'node:assert/strict';
import { jackknife, orderFee, verdict } from '../src/forward-shadow.mjs';
import { c1Entries, entryNet, scoreItems, snapshotKind } from '../src/forward-claims-c1.mjs';
import { dtEntry, dtNet, isDeepTerminal, liveState } from '../src/forward-deep-terminal.mjs';

test('order fee is cent-rounded up per order', () => {
  assert.equal(orderFee(1, 0.9, 10), 0.07); // 0.063
  assert.equal(orderFee(1, 0.65, 10), 0.16); // 0.15925
  assert.equal(orderFee(1, 0.5, 10), 0.18); // 0.175
  assert.equal(orderFee(0.5, 0.5, 10), 0.09); // 0.0875
});

test('jackknife by group and verdict thresholds', () => {
  const j = jackknife([{ g: 'a', x: 1 }, { g: 'b', x: 2 }, { g: 'c', x: 3 }]);
  assert.equal(j.mean, 2); assert.ok(Math.abs(j.se - Math.sqrt(1 / 3)) < 1e-12);
  assert.equal(verdict(j, 12), 'PENDING (3/12 events)');
  assert.equal(verdict({ groups: 12, mean: 0.1, se: 0.01, t: 10 }, 12), 'PASS');
  assert.equal(verdict({ groups: 12, mean: 0.1, se: 0.1, t: 1 }, 12), 'FAIL');
  assert.equal(verdict({ groups: 60, mean: -0.1, se: 0.01, t: -10 }, 60), 'FAIL');
  assert.equal(verdict({ groups: 60, mean: 0.03, se: 0, t: NaN }, 60), 'PASS');
  assert.ok(Number.isNaN(jackknife([]).mean));
});

test('C1 snapshot timing: window, late, once', () => {
  assert.equal(snapshotKind(24, false), 'window');
  assert.equal(snapshotKind(23, false), 'window');
  assert.equal(snapshotKind(25.5, false), null);
  assert.equal(snapshotKind(22, false), 'late');
  assert.equal(snapshotKind(24, true), null);
  assert.equal(snapshotKind(-1, false), null);
});

test('C1 entries: YES ask in [0.15, 0.65], buy NO at 1 - bid, only against a YES bid', () => {
  const mk = (t, bid, ask) => ({ ticker: t, yes_bid_dollars: String(bid), yes_ask_dollars: String(ask), floor_strike: 1 });
  const es = c1Entries([mk('a', 0.1, 0.14), mk('b', 0.1, 0.15), mk('c', 0.6, 0.65), mk('d', 0.6, 0.66), mk('e', 0, 0.3)], 1);
  // e has no YES bid, so no NO is offered: it is not an entry.
  assert.deepEqual(es.map((e) => e.ticker), ['b', 'c']);
  assert.equal(es[0].no_price, 0.9); assert.equal(es[0].fee_order, 0.07);
  assert.equal(entryNet(es[0], 'no'), 1 - 0.9 - 0.007);
  assert.equal(entryNet(es[0], 'yes'), -0.9 - 0.007);
});

test('C1 scoring excludes late snapshots from the verdict set', () => {
  const e = { ticker: 't1', no_price: 0.5, fee_per_contract: 0.01 };
  const rows = [
    { type: 'snapshot', event_ticker: 'E1', kind: 'window', entries: [e, { ...e, ticker: 't2' }] },
    { type: 'snapshot', event_ticker: 'E2', kind: 'late', entries: [{ ...e, ticker: 't3' }] },
    { type: 'result', ticker: 't1', result: 'no' }, { type: 'result', ticker: 't3', result: 'no' },
  ];
  const s = scoreItems(rows);
  assert.equal(s.items.length, 1); assert.equal(s.late.length, 1); assert.equal(s.pending, 1);
  assert.ok(Math.abs(s.items[0].x - 0.49) < 1e-12);
});

const nflEv = ({ period = 4, clock = 120, h = 35, a = 7, poss = '1', state = 'in' } = {}) => ({
  id: '9', competitions: [{ status: { clock, displayClock: '2:00', period, type: { state } }, situation: { possession: poss },
    competitors: [{ homeAway: 'home', score: String(h), team: { id: '1' } }, { homeAway: 'away', score: String(a), team: { id: '2' } }] }],
});
const mlbEv = ({ detail = 'Bot 9th', outs = 1, h = 5, a = 1 } = {}) => ({
  id: '8', competitions: [{ status: { type: { state: 'in', detail } }, situation: { outs },
    competitors: [{ homeAway: 'home', score: String(h), team: { id: '1' } }, { homeAway: 'away', score: String(a), team: { id: '2' } }] }],
});

test('liveState: football 28 up with 2:00 left, leader has ball is deep terminal', () => {
  const st = liveState('nfl', nflEv());
  assert.equal(st.leader, 'home'); assert.equal(st.regime.needed, 4); assert.equal(st.regime.available, 0); // floor(120/150)=0, leader (home) holds the ball
  assert.equal(isDeepTerminal(st), true); // slack -3
});

test('liveState: unknown possession counts for the trailer; slack -1 is not deep', () => {
  const st = liveState('nfl', nflEv({ h: 17, a: 7, poss: null })); // need 2, available floor(120/150)+1 = 1, slack -1
  assert.equal(st.regime.slack, -1); assert.equal(isDeepTerminal(st), false);
  assert.equal(isDeepTerminal(liveState('nfl', nflEv({ h: 14, a: 14 }))), false); // tied
  assert.equal(liveState('nfl', nflEv({ state: 'post' })), null);
  assert.equal(isDeepTerminal(liveState('ncaaf', nflEv({ period: 5 }))), false); // overtime
});

test('liveState: MLB halves and outs', () => {
  const a = liveState('mlb', mlbEv()); // bottom 9th, home up 4, away bats no more
  assert.equal(a.regime.available, 0); assert.equal(a.regime.needed, 4); assert.equal(isDeepTerminal(a), true);
  const b = liveState('mlb', mlbEv({ detail: 'Top 9th', outs: 0, h: 5, a: 1 })); // away trailer has 3 outs, needs 4: slack -1
  assert.equal(b.regime.slack, -1); assert.equal(isDeepTerminal(b), false);
  const c = liveState('mlb', mlbEv({ detail: 'End 8th', outs: 3, h: 6, a: 1 })); // next: top 9, 3 outs, needs 5: slack -2
  assert.equal(c.regime.slack, -2); assert.equal(isDeepTerminal(c), true);
  const d = liveState('mlb', mlbEv({ detail: 'Mid 9th', h: 6, a: 1 })); // bottom 9, away has no outs left
  assert.equal(d.regime.available, 0);
  assert.equal(liveState('mlb', mlbEv({ detail: 'Delayed' })), null);
  assert.equal(isDeepTerminal(liveState('mlb', mlbEv({ detail: 'Top 10th' }))), false); // extras are contested
});

test('dtEntry: ask band, book shape, favourite, fee', () => {
  const m = (bid, ask) => ({ ticker: 'T', yes_bid_dollars: String(bid), yes_ask_dollars: String(ask) });
  const ok = dtEntry(m(0.95, 0.96), 0.5);
  assert.equal(ok.price, 0.96); assert.ok(Math.abs(ok.fee - 0.07 * 0.5 * 0.96 * 0.04) < 1e-12);
  assert.equal(dtEntry(m(0.95, 0.985), 1).price, 0.985);
  assert.match(dtEntry(m(0.99, 0.99), 1).reason, /outside band/u);
  assert.match(dtEntry(m(0.85, 0.89), 1).reason, /outside band/u);
  assert.match(dtEntry(m(0.8, 0.95), 1).reason, /spread/u);
  assert.match(dtEntry(m(0.95, 1), 1).reason, /one-sided/u);
  assert.match(dtEntry(m(0, 0.95), 1).reason, /one-sided/u);
  assert.equal(dtNet({ price: 0.96, fee: 0.001 }, 'yes'), 1 - 0.96 - 0.001);
  assert.equal(dtNet({ price: 0.96, fee: 0.001 }, 'no'), -0.961);
});


test('forward experiments are importable by the MetroPlat operation registry without invoking their CLIs', async () => {
  const [claims, terminal] = await Promise.all([
    import('../scripts/forward-claims-c1.mjs'),
    import('../scripts/forward-deep-terminal.mjs'),
  ]);
  for (const fn of [claims.forwardClaimsCycle, claims.forwardClaimsScore, terminal.forwardDeepTerminalCycle, terminal.forwardDeepTerminalScore])
    assert.equal(typeof fn, 'function');
});
