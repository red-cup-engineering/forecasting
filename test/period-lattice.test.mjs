import test from 'node:test';
import assert from 'node:assert/strict';
import { legMeta } from '../src/combo-pricer.mjs';
import { scoreCells, flexInterval, brierProjection, gameInterval } from '../src/combo-rigidity.mjs';
import { periodRegion, periodCells, gamePeriodInterval } from '../src/period-lattice.mjs';

const G = '26OCT11CHIGB'; // away CHI = 0, home GB = 1
const reg = (series, suffix, game = G) => periodRegion(legMeta(`${series}-${game}-${suffix}`, `${series}-${game}`));
const world = (p1, p2) => ({ periods: [p1, p2], final: [p1[0] + p2[0], p1[1] + p2[1]] });

test('region semantics of each verified period ticker kind', () => {
  // totals: suffix N means strictly more than N - 0.5, i.e. >= N
  const t1 = reg('KXNFL1HTOTAL', '8');
  assert.equal(t1.test(world([4, 3], [0, 0])), false); assert.equal(t1.test(world([4, 4], [0, 0])), true);
  assert.equal(t1.test(world([3, 3], [30, 30])), false, '2H points do not count for 1H');
  const t2 = reg('KXNFL2HTOTAL', '8');
  assert.equal(t2.test(world([30, 30], [4, 3])), false); assert.equal(t2.test(world([0, 0], [4, 4])), true);
  assert.equal(reg('KXNFL1QTOTAL', '8').test(world([8, 0], [0, 0])), true);
  assert.equal(reg('KXNHL1PTOTAL', '3', '26OCT08TORVGK').test(world([2, 1], [0, 0])), true);
  assert.equal(reg('KXMLBF5TOTAL', '7', '26OCT072200MILSD').test(world([3, 3], [9, 9])), false);
  assert.equal(reg('KXEPL1HTOTAL', '3', '26SEP20FULMUN').test(world([2, 1], [0, 0])), true);
  // spread: team wins the half by >= N
  const sp = reg('KXNFL1HSPREAD', 'GB8');
  assert.equal(sp.test(world([0, 8], [50, 0])), true); assert.equal(sp.test(world([0, 7], [0, 0])), false);
  assert.equal(sp.test(world([8, 0], [0, 0])), false);
  assert.equal(reg('KXNFL2HSPREAD', 'CHI3').test(world([0, 20], [3, 0])), true, '2H spread reads the 2nd tile only');
  // team total
  const tt = reg('KXNFL1HTEAMTOTAL', 'GB11');
  assert.equal(tt.test(world([0, 11], [0, 0])), true); assert.equal(tt.test(world([20, 10], [0, 20])), false);
  // winner: team strike strictly ahead, TIE strike level; period ties are real in every sport
  const win = reg('KXNFL1H', 'GB'); const tie = reg('KXNFL1H', 'TIE');
  assert.equal(win.test(world([3, 10], [0, 0])), true); assert.equal(win.test(world([10, 10], [0, 7])), false);
  assert.equal(tie.test(world([10, 10], [0, 7])), true); assert.equal(tie.test(world([10, 9], [0, 0])), false);
  assert.equal(reg('KXNBA1H', 'TIE', '26OCT10DETWAS').test(world([50, 50], [0, 9])), true);
  assert.equal(reg('KXMLBF5', 'TIE', '26OCT072200MILSD').test(world([2, 2], [0, 1])), true);
  assert.equal(reg('KXEPL1HBTTS', 'BTTS', '26SEP20FULMUN').test(world([1, 0], [0, 5])), false);
  assert.equal(reg('KXEPL1HBTTS', 'BTTS', '26SEP20FULMUN').test(world([1, 1], [0, 0])), true);
  // final lines are colours of the last edge: overtime sits in the second tile
  const full = reg('KXNFLTOTAL', '45');
  assert.equal(full.test(world([20, 5], [10, 10])), true); assert.equal(full.test(world([20, 5], [10, 9])), false);
  assert.equal(full.tile, 'F');
  // unsupported: NHL 2P, football 3Q have no two-tile reading
  assert.equal(reg('KXNFL3QTOTAL', '8'), null);
  assert.equal(reg('KXNHL2PTOTAL', '3', '26OCT08TORVGK'), null);
});

test('period cells: a 1H total and a full total with the matching rule', () => {
  const regions = [reg('KXNFL1HTOTAL', '10'), reg('KXNFLTOTAL', '8')];
  const { cells, member } = periodCells(regions);
  // 1H >= 10 implies final >= 8: no cell has the first and not the second
  const only1 = member[0].filter((k) => !member[1].includes(k));
  assert.equal(only1.length, 0);
  assert.equal(cells.length, 3);
  for (const c of cells) { // witnesses are tilings: colour of last edge = sum of increments
    const { periods: [p, q], final } = c.witness;
    assert.deepEqual(final, [p[0] + q[0], p[1] + q[1]]);
    regions.forEach((r, i) => assert.equal(r.test(c.witness), c.sig[i] === '1'));
  }
});

test('final-only period lattice has the cells of scoreCells', () => {
  const metas = [['KXNFLTOTAL', '45'], ['KXNFLSPREAD', 'GB3'], ['KXNFLTEAMTOTAL', 'CHI20'], ['KXNFLGAME', 'GB']];
  const mset = metas.map(([s, x]) => legMeta(`${s}-${G}-${x}`, `${s}-${G}`));
  const pr = mset.map(periodRegion);
  for (const noDraw of [false, true]) {
    const a = periodCells(pr, { noDraw }); const b = scoreCells(mset.map((m) => ({ ...periodRegion(m), test: (x) => periodRegion(m).test({ periods: [x, [0, 0]], final: x }) })), { noDraw });
    assert.deepEqual(a.cells.map((c) => c.sig).sort(), b.cells.map((c) => c.sig).sort());
  }
});

test('box doubling does not change the cell set (randomised small arrangements)', () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const make = () => {
    const out = []; const k = 3 + rnd(3);
    for (let i = 0; i < k; i += 1) {
      const n = 1 + rnd(5); const kind = rnd(6);
      const r = kind === 0 ? reg('KXNFL1HTOTAL', String(n)) : kind === 1 ? reg('KXNFL2HTOTAL', String(n))
        : kind === 2 ? reg('KXNFLTOTAL', String(n)) : kind === 3 ? reg('KXNFL1HSPREAD', `GB${n}`)
          : kind === 4 ? reg('KXNFLSPREAD', `CHI${n}`) : reg('KXNFL2HTEAMTOTAL', `GB${n}`);
      out.push(r);
    }
    return out;
  };
  for (let t = 0; t < 8; t += 1) {
    const regions = make();
    for (const noDraw of [false, true]) {
      const a = periodCells(regions, { noDraw, box: 2 }).cells.map((c) => c.sig).sort();
      const b = periodCells(regions, { noDraw, box: 4 }).cells.map((c) => c.sig).sort();
      assert.deepEqual(a, b);
    }
  }
});

const ev = (s) => `${s}-${G}`;
const tk = (s, x) => `${s}-${G}-${x}`;
const book = (s, x, bid, ask = bid) => ({ ticker: tk(s, x), event: ev(s), bid, ask });
const leg = (s, x, side = 'yes') => ({ ticker: tk(s, x), event: ev(s), side });

test('a 1H total and a full total pin the parlay tighter than Frechet', () => {
  const books = [book('KXNFL1HTOTAL', '30', 0.3), book('KXNFLTOTAL', '25', 0.9)];
  const iv = gamePeriodInterval([leg('KXNFL1HTOTAL', '30'), leg('KXNFLTOTAL', '25')], books);
  assert.equal(iv.coherent, true); assert.equal(iv.split, '1H');
  const frechet = [Math.max(0, 0.3 + 0.9 - 1), Math.min(0.3, 0.9)];
  assert.ok(iv.lo > frechet[0] + 0.05, `lo ${iv.lo} vs ${frechet[0]}`);
  assert.ok(iv.hi <= frechet[1] + 1e-9 && iv.hi - iv.lo < frechet[1] - frechet[0]);
  assert.ok(Math.abs(iv.lo - 0.3) < 1e-7 && Math.abs(iv.hi - 0.3) < 1e-7, '1H>=30 forces full>=25: pinned at 0.3');
  // the same legs on the final lattice alone brace nothing
  const flat = gameInterval([leg('KXNFL1HTOTAL', '30'), leg('KXNFLTOTAL', '25')], books);
  assert.ok(flat.lo <= frechet[0] + 1e-9);
  // 1H over 30 and NOT full over 25 is impossible: hi falls from the Frechet 0.1 to 0
  const no = gamePeriodInterval([leg('KXNFL1HTOTAL', '30'), leg('KXNFLTOTAL', '25', 'no')], books);
  assert.ok(Math.abs(no.hi) < 1e-7 && Math.abs(no.lo) < 1e-7);
});

test('a 1H total priced above the full total is incoherent', () => {
  const books = [book('KXNFL1HTOTAL', '25', 0.6), book('KXNFLTOTAL', '25', 0.5)];
  const iv = gamePeriodInterval([leg('KXNFLTOTAL', '25')], books);
  assert.equal(iv.coherent, false);
  const regions = books.map((b) => periodRegion(legMeta(b.ticker, b.event)));
  const { cells, member } = periodCells(regions);
  const proj = brierProjection(cells.length, member, [0.6, 0.5]);
  assert.ok(proj.prices[0] <= proj.prices[1] + 1e-6 && proj.distance2 > 1e-3);
  // and the raw LP agrees
  assert.equal(flexInterval(cells.length, member.map((c, i) => ({ cells: c, lo: [0.6, 0.5][i], hi: [0.6, 0.5][i] })), [0]).coherent, false);
});

test('with only final-score markets the period lattice reproduces gameInterval', () => {
  const books = [book('KXNFLTOTAL', '45', 0.5, 0.55), book('KXNFLTOTAL', '55', 0.2, 0.25), book('KXNFLSPREAD', 'GB3', 0.5, 0.56), book('KXNFLGAME', 'GB', 0.55, 0.6), book('KXNFLTEAMTOTAL', 'GB24', 0.5, 0.55)];
  const legs = [leg('KXNFLTOTAL', '45'), leg('KXNFLSPREAD', 'GB3'), leg('KXNFLGAME', 'GB', 'no')];
  const a = gameInterval(legs, books); const b = gamePeriodInterval(legs, books);
  assert.equal(b.nCells, a.nCells);
  assert.ok(Math.abs(a.lo - b.lo) < 1e-9 && Math.abs(a.hi - b.hi) < 1e-9, `${a.lo},${a.hi} vs ${b.lo},${b.hi}`);
});

test('a realistic NFL set stays tractable', () => {
  const books = [];
  for (const n of [20, 22, 24, 26, 28, 30]) books.push(book('KXNFL1HTOTAL', String(n), 0.4, 0.45));
  for (const n of [40, 44, 48, 52, 55]) books.push(book('KXNFLTOTAL', String(n), 0.4, 0.45));
  for (const n of [3, 7, 10]) books.push(book('KXNFLSPREAD', `GB${n}`, 0.3, 0.35));
  for (const n of [14, 20, 27]) books.push(book('KXNFLTEAMTOTAL', `GB${n}`, 0.4, 0.45));
  const t = Date.now();
  const { cells } = periodCells(books.map((b) => periodRegion(legMeta(b.ticker, b.event))));
  console.log(`realistic NFL set: ${books.length} markets, ${cells.length} cells, ${Date.now() - t} ms`);
  assert.ok(cells.length > 100 && Date.now() - t < 60000);
});
