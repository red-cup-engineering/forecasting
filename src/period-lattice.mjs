/**
 * The period lattice: a game as a chain of Wang tiles, so period markets and full-game markets brace
 * each other. combo-rigidity.mjs prices on the FINAL score alone; a first-half total there is "not a
 * function of the final score" and falls back to Fréchet bounds. Here tile k carries the increment of
 * period k, y_k = (away, home) >= 0, and adjacent tiles meet on an edge whose colour is the cumulative
 * score c_k = y_1 + ... + y_k. A market is a region of one tile's increment or of one edge colour
 * (c_1 for "first half", c_2 = the final score for a full-game line). A world is a tiling; the matching
 * rule (c_2 = y_1 + y_2) is what lets "1H total >= 24" and "game total >= 48" constrain each other.
 * Two tiles: the FIRST SEGMENT (1H / 1Q / 1P / F5) and the REMAINDER (the rest of the game, overtime
 * and extra innings included). Only one first-segment kind can be on the lattice at a time (a game
 * with 1Q and 1H markets would need three tiles); `gamePeriodInterval` keeps the segment the legs
 * name, else the most quoted, and leaves markets of the other segments to Fréchet bounds.
 *
 * Verified Kalshi semantics (public API markets endpoint, 2026-10-07, rules_primary/secondary):
 *  - Strike convention, every family: ticker suffix N and floor_strike N - 0.5, strike_type
 *    "greater". "Total ... over 7.5" is x >= 8; suffix 8. Same ">= N" reading as the full-game lines.
 *  - KXNFL1HTOTAL, KXNCAAF1HTOTAL, KXNBA1HTOTAL, KXWNBA1HTOTAL, KXEPL1HTOTAL: both teams' points
 *    (goals) in the 1st half > N - 0.5. Tile 1 total. NBA/WNBA/NFL/NCAAF 1H = first two quarters.
 *    EPL 1H = first 45 minutes plus stoppage time.
 *  - KXNFL1HSPREAD, KXNBA1HSPREAD, KXEPL1HSPREAD ...-<TEAM><N>: TEAM wins the 1st half by > N - 0.5:
 *    tile 1 margin of TEAM >= N. KXNFL1QSPREAD, KXNHL1PSPREAD, KXMLBF5SPREAD alike on their segment.
 *  - KXNFL1HTEAMTOTAL ...-<TEAM><N>: TEAM scores > N - 0.5 in the 1st half: tile 1 team count >= N.
 *  - KXNFL1H, KXNBA1H, KXNCAAF1H, KXEPL1H, KXNFL1Q, KXNHL1P, KXMLBF5 ...-<TEAM>: team strikes are
 *    YES iff that team strictly outscores the other in the segment; the -TIE strike is YES iff the
 *    segment is level ("if both teams score the same, all team strikes resolve to No and Tie to Yes").
 *    A period tie is a real outcome even in sports whose final score cannot be level.
 *  - KXNFL2HTOTAL, KXNCAAF2HTOTAL, KXNFL2HSPREAD, KXNFL2H: the 2nd half INCLUDING overtime. So the
 *    second tile of a football or basketball game is the remainder (final = 1H + 2H) and the full-game
 *    lines (KXNFLTOTAL, which counts overtime) are colours of the last edge. NHL 3rd-period markets
 *    do NOT include overtime and 2P/3P markets are not "remainder": unsupported (null). Quarters
 *    2Q/3Q/4Q (KXNFL2QTOTAL, KXNFL3QTOTAL) likewise need three or more tiles: unsupported.
 *  - KXEPL1HBTTS: both teams score in the 1st half: tile 1 both counts >= 1.
 *  - KXMLBF5TOTAL: runs in the first 5 innings. Extra innings belong to the remainder only.
 *  - Full-game NFL winner settles $0.50 per team on a tie (rules_secondary); that is the existing
 *    final-lattice reading in scoreRegion and is not changed here.
 *
 * Cells. Regions depend on y_1 (tile-1 scope; c_1 = y_1), on y_2 (tile-2 scope) or on c_2 = y_1 + y_2
 * (final scope). A cell is a realisable triple of sign vectors (m1, m2, mF); the reduction below
 * enumerates the sign classes of y_1 and y_2 separately, then combines class pairs: for each pair
 * only the final-scope sign vector varies, and it is read from a table of the sum grid, so a pair
 * costs one array lookup per point pair and the cell set is kept by a bit-flag per (class pair,
 * final class), never a string per world. Box: each tile coordinate runs over [0, 2B + 1] where B is
 * the largest threshold of any region (min 2). Every line is a >= N test with N <= B on a, h, a + h
 * or a - h, so a coordinate beyond B (or a margin beyond B) leaves each tile test unchanged, and the
 * sum grid reaches 4B + 2 > B so every final test takes both values. That the box is also
 * sufficient for sign vectors that mix tile and sum tests is not proved here; it is checked by
 * doubling the box on randomised small arrangements (test/period-lattice.test.mjs). With no final
 * region and no draw exclusion the cells are the product of the two tiles' classes. With no tile
 * region at all, the lattice is the final-score lattice of combo-rigidity.mjs, cell for cell.
 */
import { flexInterval, rigidity, scoreRegion } from './combo-rigidity.mjs';
import { legMeta, teamSide } from './combo-pricer.mjs';

const NO_DRAW = new Set(['NBA', 'WNBA', 'NCAAB', 'MLB', 'NHL']);
const FIRST_SEGMENTS = new Set(['1H', '1Q', '1P', 'F5']);

/** Split of a leg's kind into {segment, line}: '1HTOTAL' -> 1H/TOTAL, '1H' -> 1H/WIN, null otherwise. */
function parseKind(kind) {
  const m = /^(1H|2H|1Q|1P|F5)(TOTAL|SPREAD|TEAMTOTAL|BTTS)?$/u.exec(kind ?? '');
  return m ? { segment: m[1], line: m[2] ?? 'WIN' } : null;
}

/** The tile whose increment a segment names: first segments are tile 1, the 2nd half is tile 2. */
const tileOf = (segment) => (segment === '2H' ? 2 : 1);

/**
 * The region of worlds a leg's YES side names. Period legs read one tile's increment; legs that are a
 * function of the final score are lifted through the final colour. null when neither applies.
 * @returns {{test: (w: {periods: number[][], final: number[]}) => boolean, bound: number, key: string, tile: 1|2|'F', split: string|null}|null}
 */
export function periodRegion(meta) {
  const pk = parseKind(meta.kind);
  if (!pk) {
    const r = scoreRegion(meta);
    return r ? { test: (w) => r.test(w.final), bound: r.bound, key: r.key, tile: 'F', split: null } : null;
  }
  const { segment, line } = pk;
  const tile = tileOf(segment);
  const at = (w) => w.periods[tile - 1];
  const mk = (test, bound, key) => ({ test: (w) => test(at(w)), bound, key: `${segment}:${key}`, tile, split: segment });
  const n = Number((/(\d+)$/u.exec(meta.suffix ?? '') ?? [])[1]);
  if (line === 'BTTS') return mk((x) => x[0] >= 1 && x[1] >= 1, 1, 'btts');
  if (line === 'WIN') {
    if (meta.suffix === 'TIE') return mk((x) => x[0] === x[1], 1, 'tie');
    const t = teamSide(meta);
    return t === null ? null : mk((x) => x[t] > x[1 - t], 1, `win${t}`);
  }
  if (!Number.isFinite(n)) return null;
  if (line === 'TOTAL') return mk((x) => x[0] + x[1] >= n, n, `tot${n}`);
  const t = teamSide(meta);
  if (t === null) return null;
  if (line === 'SPREAD') return mk((x) => x[t] - x[1 - t] >= n, n, `spr${t}:${n}`);
  return mk((x) => x[t] >= n, n, `tt${t}:${n}`);
}

/**
 * The atoms of the arrangement of period/final regions over two-tile worlds.
 * @param {ReturnType<typeof periodRegion>[]} regions
 * @returns {{cells: {witness: {periods: number[][], final: number[]}, sig: string}[], member: number[][]}}
 */
export function periodCells(regions, { noDraw = false, box = 2 } = {}) {
  const segs = new Set(regions.map((r) => r.split).filter((s) => s && s !== '2H'));
  if (segs.size > 1) throw new Error(`period lattice holds one first segment, got ${[...segs].join(',')}`);
  if (regions.some((r) => r.split === '2H') && segs.size && !segs.has('1H')) throw new Error('2H is the remainder only of a 1H split');
  const B = Math.max(2, ...regions.map((r) => r.bound));
  const T = box * B + 1; // tile coordinates 0..T
  const group = { 1: [], 2: [], F: [] };
  regions.forEach((r, i) => group[r.tile].push(i));
  const pts = []; for (let a = 0; a <= T; a += 1) for (let h = 0; h <= T; h += 1) pts.push([a, h]);
  // sign classes of one tile: class id per point, and the points of each class
  const classify = (idx, tile) => {
    const ids = new Map(); const members = []; const of = new Int32Array(pts.length);
    pts.forEach((x, p) => {
      const w = { periods: tile === 1 ? [x, [0, 0]] : [[0, 0], x], final: x };
      const sig = idx.map((i) => (regions[i].test(w) ? '1' : '0')).join('');
      let id = ids.get(sig);
      if (id === undefined) { id = members.length; ids.set(sig, id); members.push({ sig, points: [] }); }
      of[p] = id; members[id].points.push(p);
    });
    return members;
  };
  const c1 = classify(group[1], 1); const c2 = classify(group[2], 2);
  // final colour table over the sum grid
  const S = 2 * T + 1; const fids = new Map(); const fsigs = [];
  const fOf = new Int32Array(S * S).fill(-1);
  for (let a = 0; a < S; a += 1) for (let h = 0; h < S; h += 1) {
    if (noDraw && a === h) continue;
    const x = [a, h]; const w = { periods: [x, [0, 0]], final: x };
    const sig = group.F.map((i) => (regions[i].test(w) ? '1' : '0')).join('');
    let id = fids.get(sig);
    if (id === undefined) { id = fsigs.length; fids.set(sig, id); fsigs.push(sig); }
    fOf[a * S + h] = id;
  }
  const nF = fsigs.length;
  const cells = []; const seenSum = new Set();
  const emit = (s1, s2, sf, y1, y2) => {
    const sig = new Array(regions.length).fill('0');
    group[1].forEach((i, k) => { sig[i] = s1[k]; });
    group[2].forEach((i, k) => { sig[i] = s2[k]; });
    group.F.forEach((i, k) => { sig[i] = sf[k]; });
    cells.push({ witness: { periods: [y1, y2], final: [y1[0] + y2[0], y1[1] + y2[1]] }, sig: sig.join('') });
  };
  if (group.F.length === 0 && !noDraw) {
    for (const k1 of c1) for (const k2 of c2) emit(k1.sig, k2.sig, '', pts[k1.points[0]], pts[k2.points[0]]);
  } else if (c1.length === 1 && c2.length === 1) {
    // no tile region: the lattice is the final-score lattice, read straight off the sum grid
    for (let a = 0; a < S; a += 1) for (let h = 0; h < S; h += 1) {
      const f = fOf[a * S + h];
      if (f < 0 || seenSum.has(f)) continue;
      seenSum.add(f);
      const y1 = [Math.min(a, T), Math.min(h, T)];
      emit(c1[0].sig, c2[0].sig, fsigs[f], y1, [a - y1[0], h - y1[1]]);
    }
  } else {
    for (const k1 of c1) for (const k2 of c2) {
      const seen = new Uint8Array(nF);
      for (const p of k1.points) {
        const [a1, h1] = pts[p];
        for (const q of k2.points) {
          const [a2, h2] = pts[q];
          const f = fOf[(a1 + a2) * S + h1 + h2];
          if (f >= 0 && !seen[f]) { seen[f] = 1; emit(k1.sig, k2.sig, fsigs[f], pts[p], pts[q]); }
        }
      }
    }
  }
  const member = regions.map((_, i) => cells.flatMap((c, k) => (c.sig[i] === '1' ? [k] : [])));
  return { cells, member };
}

const arrangements = new Map();
function cachedPeriodCells(regions, noDraw) {
  const key = `${noDraw}|${regions.map((r) => r.key).join(',')}`;
  let hit = arrangements.get(key);
  if (!hit) {
    if (arrangements.size >= 256) arrangements.delete(arrangements.keys().next().value);
    hit = periodCells(regions, { noDraw }); arrangements.set(key, hit);
  }
  return hit;
}

/** Is a region on the chosen first segment's lattice? (final regions always; 2H only after 1H.) */
const fits = (r, split) => r.split === null || r.split === split || (r.split === '2H' && split === '1H');

/**
 * The flex interval of one game's legs on the period lattice; shape of gameInterval in
 * combo-rigidity.mjs plus `split`. Legs/books outside the chosen first segment (or not regions at all)
 * are priced by Fréchet bounds against the lattice part.
 */
export function gamePeriodInterval(legs, books) {
  const metaOf = (x) => legMeta(x.ticker, x.event);
  const legMetas = legs.map(metaOf);
  const sport = legMetas[0]?.sport;
  const cand = [...legMetas, ...books.map(metaOf)].map(periodRegion);
  const count = new Map();
  cand.forEach((r, i) => { if (r?.split && r.split !== '2H') count.set(r.split, (count.get(r.split) ?? 0) + (i < legs.length ? 1e6 : 1)); });
  const split = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '1H';
  const regionOf = (m) => { const r = periodRegion(m); return r && fits(r, split) ? r : null; };
  const quoted = books.map((b) => ({ ...b, region: regionOf(metaOf(b)) })).filter((b) => b.region);
  const legRegions = legMetas.map(regionOf);
  const regions = [...quoted.map((b) => b.region), ...legRegions.filter(Boolean)];
  const { cells, member } = cachedPeriodCells(regions, NO_DRAW.has(sport));
  const n = cells.length;
  const markets = quoted.map((b, i) => ({ cells: member[i], lo: b.bid ?? 0, hi: b.ask ?? 1 }));
  let target = new Set(cells.map((_, k) => k)); let j = quoted.length;
  legs.forEach((l, i) => {
    if (!legRegions[i]) return;
    const inside = new Set(member[j]); j += 1;
    target = new Set([...target].filter((k) => (l.side === 'yes') === inside.has(k)));
  });
  const iv = flexInterval(n, markets, [...target]);
  const modelled = legRegions.filter(Boolean).length;
  if (!iv.coherent) return { coherent: false, lo: 0, hi: 1, modelled, free: 0, nCells: n, split };
  const free = legs.filter((_, i) => !legRegions[i]).map((l) => {
    const b = books.find((x) => x.ticker === l.ticker);
    const yesLo = b?.bid ?? 0; const yesHi = b?.ask ?? 1;
    return l.side === 'yes' ? [yesLo, yesHi] : [1 - yesHi, 1 - yesLo];
  });
  const k = free.length;
  const lo = Math.max(0, iv.lo + free.reduce((s, [a]) => s + a, 0) - k);
  const hi = Math.min(iv.hi, ...free.map(([, b]) => b));
  return { coherent: true, lo, hi, scoreLo: iv.lo, scoreHi: iv.hi, modelled, free: k, nCells: n, split, superHedge: iv.superHedge, subHedge: iv.subHedge, rigidity: rigidity(n, markets.map((m) => m.cells), [...target]) };
}
