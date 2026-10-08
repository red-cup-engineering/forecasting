import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVALUATORS } from '../src/hypotheses/evaluators.mjs';
import { hypothesesDir } from '../src/hypotheses/run.mjs';
import { openStore } from '../src/hypotheses/store.mjs';

const load = (id) => JSON.parse(readFileSync(join(hypothesesDir, `${id}.json`), 'utf8'));
const dir = () => mkdtempSync(join(tmpdir(), 'hyp-ev-'));

test('combo-flex waits for every pre-registered weekend, refuses pre-registration prints, and arms by width', async () => {
  const h = load('combo-flex-f1'), ext = dir();
  const print = (g, at, width, taker, price, outcome) => JSON.stringify({ ticker: `P-${g}`, at: Date.parse(at), price, count: 1, taker, cluster: true, coherent: true, pinned: [0.2, 0.2 + width], gameCodes: [g], outcome });
  writeFileSync(join(ext, 'combo-rows-2026-10-10_2026-10-12.jsonl'), [print('g1', '2026-10-11T18:00:00Z', 0.5, 'yes', 0.6, 0), print('g2', '2026-10-11T19:00:00Z', 0.02, 'no', 0.5, 1), print('g3', '2026-10-09T19:00:00Z', 0.5, 'yes', 0.6, 0)].join('\n'));
  const r = await EVALUATORS['combo-flex'].derive({ h, externalDir: ext });
  assert.match(r.awaiting, /2026-10-17_2026-10-19/);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => [i.g, i.arm, Math.round(i.x * 100) / 100]), [['g1', 'wide', 0.6], ['g2', 'narrow', 0.5]]);
});

test('weather rules read study rows: roof parks and pre-registration games are out, net uses the unrounded fee', async () => {
  const h = load('weather-totals-r2'), ext = dir();
  const row = (event, startMs, temp, roof, bid, ask, yes) => JSON.stringify({ sport: 'mlb', event, startMs, roof, fc: { wind: 5, gust: 9, temp, precip: 0 }, rung: { bid, ask, yes } });
  writeFileSync(join(ext, 'weather-totals-rows.jsonl'), [row('e1', Date.parse('2027-01-05T00:00:00Z'), 55, false, 0.48, 0.52, false), row('e2', Date.parse('2027-01-06T00:00:00Z'), 70, false, 0.48, 0.52, false), row('e3', Date.parse('2027-01-07T00:00:00Z'), 55, true, 0.48, 0.52, false), row('e4', Date.parse('2026-10-01T00:00:00Z'), 55, false, 0.48, 0.52, false)].join('\n'));
  const r = await EVALUATORS['weather-totals-rule'].derive({ h, externalDir: ext });
  assert.deepEqual(r.items.map((i) => i.g), ['e1']);
  assert.ok(Math.abs(r.items[0].x - (1 - 0.52 - 0.07 * 0.52 * 0.48)) < 1e-12);
  assert.equal(r.notes.refused, 1);
  assert.match((await EVALUATORS['weather-totals-rule'].derive({ h, externalDir: dir() })).awaiting, /weather-totals-rows/);
});

test('deep-terminal derives from stored live entries and results, refusing entries before registration', async () => {
  const h = load('deep-terminal-dt'), store = openStore(dir());
  const e = (game, at, price) => ({ game, ticker: `${game}-T`, price, fee: 0.07 * price * (1 - price), at });
  store.put('mlb:1', 'dt-entry', e('mlb:1', '2026-10-09T01:00:00Z', 0.96), '2026-10-09T01:00:00Z');
  store.put('mlb:2', 'dt-entry', e('mlb:2', '2026-10-09T02:00:00Z', 0.95), '2026-10-09T02:00:00Z');
  store.put('mlb:3', 'dt-entry', e('mlb:3', '2026-10-07T02:00:00Z', 0.95), '2026-10-07T02:00:00Z');
  store.put('mlb:1', 'dt-result', { result: 'yes' }, '2026-10-09T05:00:00Z');
  const r = EVALUATORS['deep-terminal'].derive({ h, store });
  assert.deepEqual(r.items.map((i) => i.g), ['mlb:1']);
  assert.ok(Math.abs(r.items[0].x - (1 - 0.96 - 0.07 * 0.96 * 0.04)) < 1e-12);
  assert.deepEqual(r.notes, { refused: 1, pending: 1 });
});
