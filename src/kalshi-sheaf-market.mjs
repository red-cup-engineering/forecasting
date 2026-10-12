// The Kalshi daily-temperature market graph as a cellular sheaf (see kalshi-sheaf.mjs).
//
// Vertex  = a ladder (station, kind, date): the local section is the Normal fitted to the ladder's
//           bracket mid prices; stalk R^2 = (m, l) = (mean temperature anomaly, log-scale anomaly).
// Edge    = a linkage: neighbouring stations same day (spatial), high vs low same station-day,
//           same station adjacent day (lag 1, live) and lag 2 (settled, clamped).
//           Restriction F_u = B (fitted calibration link, ridge-shrunk toward its class), F_v = I,
//           edge metric W = inverse residual covariance. Identity restrictions would be the
//           "same quantity" case (Kalshi vs Polymarket); not present in this data.
import {
  bracketBounds, bracketProb, fitCalibrationLink, fitLadder, harmonicExtension, zeros,
} from "./kalshi-sheaf.mjs";
import {
  buildMarketSheafFromSignGraph as buildSheaf,
  marketSheafDirichlet as dirichlet,
  marketSheafVertexTension as vertexTension,
} from "./kalshi-sheaf-signgraph.mjs";

export const STATIONS = {
  AUS: [30.19, -97.67], MDW: [41.79, -87.75], DEN: [39.86, -104.67], LAX: [33.94, -118.41], MIA: [25.79, -80.29],
  NYC: [40.78, -73.97], PHL: [39.87, -75.24], ATL: [33.64, -84.43], BOS: [42.36, -71.01], DFW: [32.9, -97.04],
  DCA: [38.85, -77.04], EWR: [40.69, -74.17], HOU: [29.64, -95.28], LAS: [36.08, -115.15], MSP: [44.88, -93.22],
  MSY: [29.99, -90.26], OKC: [35.39, -97.6], PHX: [33.43, -112.01], SAN: [32.73, -117.19], SAT: [29.53, -98.47],
  SDF: [38.17, -85.74], SEA: [47.45, -122.31], SFO: [37.62, -122.38], TTN: [40.28, -74.82],
};
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export const eventDay = (ev) => { const m = ev.match(/-(\d\d)([A-Z]{3})(\d\d)$/); return Date.UTC(2000 + +m[1], MON[m[2]], +m[3]) / 86400000; };
export const dayISO = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
export const vid = (s, k, d) => `${s}.${k}.${dayISO(d)}`;
const km = (a, b) => {
  const r = Math.PI / 180, [la1, lo1] = [a[0] * r, a[1] * r], [la2, lo2] = [b[0] * r, b[1] * r];
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
};

/** events: Map "station.kind.day" -> {station, kind, day, value, markets:[{...candles}]} from the fetched files. */
export function loadEvents(files) {
  const events = new Map();
  for (const f of files) {
    const kind = f.series.startsWith("KXHIGH") ? "H" : "L";
    for (const m of f.markets) {
      const day = eventDay(m.event);
      const key = `${f.station}.${kind}.${day}`;
      let e = events.get(key);
      if (!e) events.set(key, (e = { station: f.station, kind, day, value: m.value, markets: [] }));
      e.markets.push(m);
    }
  }
  return events;
}

/** Quote of a market at time t (seconds): last hourly candle ending <= t. */
export function quoteAt(m, t) {
  let c = null, cum = 0, recent = 0;
  for (const k of m.candles) { if (k[0] <= t) { c = k; cum += k[4] || 0; if (k[0] > t - 3 * 3600) recent += k[4] || 0; } }
  if (!c) return null;
  const bid = c[1], ask = c[2];
  if (bid == null || ask == null) return null;
  return { bid, ask, mid: (bid + ask) / 2, cum, recent, last: c[3] };
}

/** Ladder section of an event at time t, or null if the ladder is not quoted/complete. */
export function ladderAt(ev, t) {
  const bs = [];
  let liq = 0;
  for (const m of ev.markets) {
    const q = quoteAt(m, t);
    if (!q) return null;
    const [lo, hi] = bracketBounds(m);
    bs.push({ lo, hi, p: q.mid, bid: q.bid, ask: q.ask, cum: q.cum, recent: q.recent, ticker: m.ticker, result: m.result });
    liq += q.cum;
  }
  if (bs.length < 4) return null;
  const f = fitLadder(bs);
  if (!f) return null;
  return { ...f, brackets: bs, liq, spreadMax: Math.max(...bs.map((b) => b.ask - b.bid)) };
}

export const snapshotTimes = { S1: (d) => (d - 1) * 86400 + 20 * 3600, S2: (d) => d * 86400 + 2 * 3600 };

/** trailing climatology of settled values: mean of days d-2 .. d-15 */
export function climatology(events, station, kind, d) {
  const xs = [];
  for (let k = 2; k <= 15; k++) { const e = events.get(`${station}.${kind}.${d - k}`); if (e && e.value != null) xs.push(e.value); }
  return xs.length >= 4 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Point-in-time vertex data for target day d at snapshot S:
 *  live ladders (s,k,d) and (s,k,d-1) at time t, settled (s,k,d-2).
 * Returns Map vertexId -> {station,kind,lag, c, m (anomaly), l (log sigma), ladder, settled}
 * logSigmaBase: Map "station.kind" -> mean log sigma (fitted on training days only).
 */
export function snapshot(events, d, S, logSigmaBase) {
  const t = typeof S === "number" ? S : snapshotTimes[S](d), V = new Map();
  for (const station of Object.keys(STATIONS)) for (const kind of ["H", "L"]) {
    const c = climatology(events, station, kind, d);
    if (c == null) continue;
    const base = logSigmaBase.get(`${station}.${kind}`);
    for (const lag of [0, 1]) {
      const ev = events.get(`${station}.${kind}.${d - lag}`);
      if (!ev) continue;
      const lad = ladderAt(ev, t);
      if (!lad || lad.sse > 0.02) continue;
      // a previous-day ladder that has (nearly) resolved has no meaningful scale: its log-scale is left free
      const resolved = lag === 1 && (lad.sigma < 0.7 || lad.sigma > 8);
      V.set(vid(station, kind, d - lag), { station, kind, lag, c, m: lad.mu - c, l: resolved ? null : Math.log(lad.sigma) - base, ladder: lad, day: d - lag, ev });
    }
    const e2 = events.get(`${station}.${kind}.${d - 2}`);
    if (e2 && e2.value != null) V.set(vid(station, kind, d - 2), { station, kind, lag: 2, c, m: e2.value - c, l: null, settled: true, day: d - 2, ev: e2 });
  }
  return V;
}

export function neighbourPairs(k = 3) {
  const names = Object.keys(STATIONS), set = new Set(), out = [];
  for (const a of names) {
    const near = names.filter((b) => b !== a).map((b) => [b, km(STATIONS[a], STATIONS[b])]).sort((x, y) => x[1] - y[1]).slice(0, k);
    for (const [b, dist] of near) { const key = [a, b].sort().join("-"); if (!set.has(key)) { set.add(key); out.push({ a: a < b ? a : b, b: a < b ? b : a, km: dist }); } }
  }
  return out;
}

/** Edge descriptors (without maps): [{cls, id, u: vertex template, v: vertex template}] given available vertices */
export function edgeTemplates(pairs) {
  const T = [];
  for (const kind of ["H", "L"]) for (const { a, b, km: dist } of pairs) T.push({ cls: `sp${kind}`, id: `sp.${kind}.${a}-${b}`, uS: a, uK: kind, uL: 0, vS: b, vK: kind, vL: 0, km: dist });
  for (const s of Object.keys(STATIONS)) {
    T.push({ cls: "HL", id: `hl.${s}`, uS: s, uK: "H", uL: 0, vS: s, vK: "L", vL: 0 });
    for (const kind of ["H", "L"]) {
      T.push({ cls: `t1${kind}`, id: `t1.${kind}.${s}`, uS: s, uK: kind, uL: 1, vS: s, vK: kind, vL: 0 });
      T.push({ cls: `t2${kind}`, id: `t2.${kind}.${s}`, uS: s, uK: kind, uL: 2, vS: s, vK: kind, vL: 0 });
    }
  }
  return T;
}
const getV = (V, d, S, kind, lag) => V.get(vid(S, kind, d - lag));

/** Fit the sheaf's restriction maps from training snapshots. */
export function fitSheafMaps(snaps /* [{d, V}] */, templates, { ridge = 8 } = {}) {
  const vec = (x) => [x.m, x.l ?? 0];
  const collect = (tp, usable) => {
    const P = [];
    for (const { d, V } of snaps) {
      const u = getV(V, d, tp.uS, tp.uK, tp.uL), v = getV(V, d, tp.vS, tp.vK, tp.vL);
      if (!u || !v || v.settled || !usable(u)) continue;
      P.push({ xu: u.l == null ? [u.m, 0] : vec(u), xv: vec(v), noL: u.l == null });
    }
    return P;
  };
  const classPairs = new Map();
  for (const tp of templates) { const P = collect(tp, () => true); (classPairs.get(tp.cls) ?? classPairs.set(tp.cls, []).get(tp.cls)).push(...P); }
  const classFit = new Map();
  for (const [cls, P] of classPairs) if (P.length >= 20) classFit.set(cls, fitCalibrationLink(P, { ridge: 1 }));
  const maps = new Map();
  for (const tp of templates) {
    const P = collect(tp, () => true), cf = classFit.get(tp.cls);
    if (!cf || P.length < 12) continue;
    const settledU = tp.uL === 2 || P.filter((p) => p.noL).length > P.length / 2; // scale datum absent for most of this link's source vertices
    const fit = fitCalibrationLink(P, { ridge, shrinkTo: cf.Fu });
    if (settledU) { fit.Fu = fit.Fu.map((r) => [r[0], 0]); }
    maps.set(tp.id, { ...fit, n: P.length });
  }
  return { maps, classFit };
}

/**
 * Assemble the sheaf for one snapshot and solve.
 * thinIds: Set of vertex ids whose coordinates are free (unknown); settled vertices have l free, m clamped.
 * Returns {sheaf, x0 (observed), xh (harmonic), freeMask, order}.
 */
export function assemble(V, templates, maps, d, freeIds) {
  const vertices = [...V.keys()].map((id) => ({ id, dim: 2 }));
  const edges = [];
  for (const tp of templates) {
    const mp = maps.get(tp.id);
    if (!mp) continue;
    const u = vid(tp.uS, tp.uK, d - tp.uL), v = vid(tp.vS, tp.vK, d - tp.vL);
    if (!V.has(u) || !V.has(v)) continue;
    edges.push({ id: tp.id, u, v, Fu: mp.Fu, Fv: mp.Fv, W: mp.W, cls: tp.cls });
  }
  const sheaf = buildSheaf(vertices, edges);
  const x0 = new Array(sheaf.n).fill(0), free = new Array(sheaf.n).fill(false);
  for (const v of vertices) {
    const o = sheaf.offset.get(v.id), z = V.get(v.id);
    x0[o] = z.m; x0[o + 1] = z.l ?? 0;
    if (freeIds.has(v.id)) { free[o] = true; free[o + 1] = true; }
    if (z.l == null) free[o + 1] = true;
  }
  return { sheaf, x0, free };
}
export { dirichlet, harmonicExtension, vertexTension, bracketProb };
