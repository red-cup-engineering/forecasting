import test from 'node:test';
import assert from 'node:assert/strict';
import { baseballTrailerOuts, footballSecondsLeft, gameRegime } from '../src/game-regime.mjs';

const fb = (period, clockSec, margin, trailerHasBall) => gameRegime({ sport: 'nfl', period, clockSec, margin, trailerHasBall });

test('football clock', () => {
  assert.equal(footballSecondsLeft(1, 900), 3600);
  assert.equal(footballSecondsLeft(4, 0), 0);
  assert.equal(footballSecondsLeft(5, 600), null);
});

test('football: 21 points with 4:00 left is terminal, 7 points is contested', () => {
  const a = fb(4, 240, 21, true); // need 3, floor(240/150)=1 + 1 = 2
  assert.equal(a.needed, 3); assert.equal(a.available, 2); assert.equal(a.regime, 'terminal');
  assert.equal(fb(4, 240, 7, true).regime, 'contested');
});

test('football: the ball decides the last possession', () => {
  assert.equal(fb(4, 100, 3, true).regime, 'contested'); // trailer has the ball and 100 s
  assert.equal(fb(4, 100, 3, false).regime, 'terminal'); // leader has it: kneel-downs
  assert.equal(fb(4, 100, 3, undefined).regime, 'contested'); // unknown counts for the trailer
});

test('football: first half is early, tied and overtime are never terminal', () => {
  assert.equal(fb(1, 600, 14, true).regime, 'early');
  assert.equal(fb(2, 0, 21, true).regime, 'contested'); // 1800 s left is not > 1800
  assert.equal(fb(4, 10, 0, true).regime, 'contested');
  assert.equal(fb(5, 300, 3, true).regime, 'contested');
});

test('baseball trailer outs', () => {
  assert.equal(baseballTrailerOuts(9, 'bottom', 0, false), 3); // home trails in the bottom of the 9th
  assert.equal(baseballTrailerOuts(9, 'top', 1, true), 2);
  assert.equal(baseballTrailerOuts(9, 'top', 0, false), 3); // home bats the bottom of the 9th
  assert.equal(baseballTrailerOuts(7, 'bottom', 2, true), 6); // away: top 8, top 9
  assert.equal(baseballTrailerOuts(10, 'top', 0, true), null);
});

test('baseball: 5 runs down with 3 outs left is terminal; 2 runs down is contested; innings 1-4 early', () => {
  const m = (inning, half, outs, margin, trailerIsAway) => gameRegime({ sport: 'mlb', inning, half, outs, margin, trailerIsAway });
  assert.equal(m(9, 'bottom', 0, 5, false).regime, 'terminal');
  assert.equal(m(9, 'bottom', 0, 2, false).regime, 'contested');
  assert.equal(m(9, 'bottom', 2, 2, false).regime, 'terminal'); // one out left
  assert.equal(m(3, 'top', 1, 4, true).regime, 'early');
  assert.equal(m(11, 'top', 0, 0, true).regime, 'contested');
  assert.equal(m(6, 'top', 0, 0, true).regime, 'contested');
});

test('unknown sport throws', () => assert.throws(() => gameRegime({ sport: 'nba', margin: 1 })));
