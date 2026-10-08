// Stage 3 of pregame-calibration.mjs: calibration tables, favourite-longshot slopes, pre-registered rules.
//
// PRE-REGISTERED RULES (written before any calibration or P&L was computed):
//  Observation unit = one market (YES contract) at T-5 min (last quote at or before start-5min); price = yes_bid / yes_ask / mid.
//  2-way events fetch one side; the other side is the complement (bid' = 1-ask, ask' = 1-bid).
//  R1 favourite: buy YES at the ask when ask in [0.70, 0.95].                     (all families, incl. soccer)
//  R2 longshot : buy NO at 1-bid when yes bid in [0.03, 0.15].                    (all families, incl. soccer)
//  S1 soccer   : (3-way soccer events only) buy NO on the TIE market at 1-bid when TIE bid in [0.15, 0.45].
//  Fee per contract = 0.07 * fee_multiplier(series) * P * (1-P), P = price paid; maker rebates ignored; no rounding.
//  Halves: H1 = start < 2026-09-01Z (Jul-Aug, in-sample), H2 = start >= 2026-09-01Z (Sep-Oct, out-of-sample).
//  Quote quality filter: both bid and ask present, ask - bid <= 0.10.
//  Calibration: bands of mid 0.1 wide; delete-one-event jackknife SE; logistic slope of y on logit(mid) (mid clipped .01-.99).
import fs from "node:fs";
import path from "node:path";

const SPORT = [
  [/^KXNFLGAME$/, "NFL"], [/^KXNCAAFGAME$|^KXNCAAFCSGAME$|^KXNCAAFD3GAME$/, "NCAAF"], [/^KXMLBGAME$/, "MLB"],
  [/^KXWNBAGAME$/, "WNBA"], [/^KXNHLGAME$/, "NHL"], [/^KX(NPB|KBO|LMB|CPL)/, "Baseball-other"],
  [/^KX(ATP|WTA|DAVIS|UNITED|LAVER)/, "Tennis"], [/^KXUFC|^KXMMA|^KXBOX/, "Combat"],
  [/^KX(KHL|SHL|ELH|AHL|LIIGA|DEL|IIHF|NCAAH)/, "Hockey-other"],
  [/^KX(NBL|ACB|ABA|BBL|LNBP|LNBELITE|EUROLEAGUE|EUROCUP|FIBA|BSL|VTB|BSN|NZNBL|CEBL|KBL|SBL|PBA|BBSERIE|NBA|NCAAMB|NCAAWB|BB|LKL|KORISLIIGA|LBP|CBA)/, "Basketball-other"],
  [/^KX(CFL|UFL|AFL)/, "Football-other"], [/^KX(T20|WT20|ODI|WODI|HUNDRED|WHUNDRED|TEST|WTEST|COUNTY|IPL|LPL|CRICKET)/, "Cricket"],
  [/^KX(RUGBY|RL|URC|PREM|SIX|NRL)/, "Rugby"],
];
const sportOf = (ser, nMk) => { if (nMk >= 3) return "Soccer"; for (const [re, n] of SPORT) if (re.test(ser)) return n; return "Other-2way"; };

const clip = (p) => Math.min(0.99, Math.max(0.01, p));
const logit = (p) => Math.log(p / (1 - p));
function irls(xs, ys) {
  let a = 0, b = 1;
  for (let it = 0; it < 30; it++) {
    let s00 = 0, s01 = 0, s11 = 0, g0 = 0, g1 = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * xs[i]))), w = Math.max(p * (1 - p), 1e-6), r = ys[i] - p;
      s00 += w; s01 += w * xs[i]; s11 += w * xs[i] * xs[i]; g0 += r; g1 += r * xs[i];
    }
    const det = s00 * s11 - s01 * s01; if (Math.abs(det) < 1e-12) break;
    const da = (s11 * g0 - s01 * g1) / det, db = (-s01 * g0 + s00 * g1) / det;
    a += da; b += db; if (Math.abs(da) + Math.abs(db) < 1e-8) break;
  }
  return [a, b];
}
const jk = (thetas, full) => { const G = thetas.length; if (G < 2) return NaN; const mean = thetas.reduce((s, x) => s + x, 0) / G; return Math.sqrt(((G - 1) / G) * thetas.reduce((s, x) => s + (x - mean) ** 2, 0)); };

// delete-one-event jackknife SE of a ratio-of-sums statistic: theta = sum(num)/sum(den)
function jkMean(rows, f) { // rows: {ev, ...}; f(row)->value ; statistic = mean over rows
  const byEv = new Map(); let S = 0, N = 0;
  for (const r of rows) { const v = f(r); S += v; N++; const e = byEv.get(r.ev) || [0, 0]; e[0] += v; e[1]++; byEv.set(r.ev, e); }
  const th = []; for (const [, [s, n]] of byEv) if (N - n > 0) th.push((S - s) / (N - n));
  return { mean: N ? S / N : NaN, se: jk(th), n: N, ev: byEv.size };
}

export function run(CACHE, { startOf }) {
  const en = JSON.parse(fs.readFileSync(path.join(CACHE, "enumerated.json")));
  const cd = JSON.parse(fs.readFileSync(path.join(CACHE, "candles.json")));
  const ser = JSON.parse(fs.readFileSync(path.join(CACHE, "series-sports.json"))).series;
  const feeM = Object.fromEntries(ser.map((s) => [s.ticker, s.fee_multiplier]));
  const H = Date.parse("2026-09-01T00:00:00Z") / 1000;
  const obs = { 5: [], 60: [] }; const cover = {};
  const lastBefore = (cs, t) => { let r = null; for (const c of cs) if (c.t <= t) r = c; else break; return r; };
  for (const [sr, d] of Object.entries(en)) {
    const by = {}; for (const m of d.markets) (by[m.e] ||= []).push(m);
    for (const [e, ms] of Object.entries(by)) {
      const start = startOf(ms); if (!start) continue;
      const sport = sportOf(sr, ms.length);
      const have = ms.filter((m) => m.t in cd);
      if (!have.length) continue;
      const c = (cover[sport] ||= { ev: 0, ok5: 0, ok60: 0 }); c.ev++;
      for (const X of [5, 60]) {
        const rows = [];
        for (const m of have) {
          const q = lastBefore(cd[m.t], start - X * 60);
          if (!q || q.b == null || q.a == null || q.a - q.b > 0.10 || q.a < q.b) continue;
          const y = m.r === "yes" ? 1 : m.r === "no" ? 0 : null; if (y === null) continue;
          rows.push({ ev: e, sr, sport, half: start < H ? 1 : 2, b: q.b, a: q.a, mid: (q.a + q.b) / 2, y, tie: /-TIE$/.test(m.t), fee: feeM[sr] ?? 1, start });
          if (ms.length === 2 && have.length === 1) { const o = ms.find((x) => x !== m); const yo = o.r === "yes" ? 1 : o.r === "no" ? 0 : null; if (yo !== null) rows.push({ ev: e, sr, sport, half: start < H ? 1 : 2, b: 1 - q.a, a: 1 - q.b, mid: 1 - (q.a + q.b) / 2, y: yo, tie: false, fee: feeM[sr] ?? 1, start }); }
        }
        if (rows.length) { obs[X].push(...rows); c["ok" + X]++; }
      }
    }
  }
  const out = [];
  const P = (s) => out.push(s);
  P("## Coverage (events with a usable quote)\n\n| sport | events | usable T-5 | usable T-60 |\n|---|---|---|---|");
  for (const [s, c] of Object.entries(cover).sort((a, b) => b[1].ev - a[1].ev)) P(`| ${s} | ${c.ev} | ${c.ok5} | ${c.ok60} |`);
  const sports = Object.keys(cover).sort((a, b) => cover[b].ev - cover[a].ev);
  const f2 = (x) => (isNaN(x) ? "-" : x.toFixed(3)), c1 = (x) => (isNaN(x) ? "-" : (100 * x).toFixed(1));

  for (const X of [5, 60]) {
    P(`\n## Calibration at T-${X} min (by sport; realised minus mid, cents; jackknife SE by event)\n`);
    P("| sport | events | markets | logistic slope (SE) | intercept | " + [...Array(10).keys()].map((i) => `${i / 10}-${(i + 1) / 10}`).join(" | ") + " |\n|" + "---|".repeat(15));
    const detail = [];
    for (const s of ["ALL", ...sports]) {
      const rows = obs[X].filter((r) => s === "ALL" || r.sport === s);
      if (rows.length < 30) continue;
      const xs = rows.map((r) => logit(clip(r.mid))), ys = rows.map((r) => r.y);
      const [a, b] = irls(xs, ys);
      const evs = [...new Set(rows.map((r) => r.ev))];
      let se = NaN;
      if (evs.length <= 900) { const th = []; for (const ev of evs) { const ix = rows.map((r, i) => (r.ev !== ev ? i : -1)).filter((i) => i >= 0); th.push(irls(ix.map((i) => xs[i]), ix.map((i) => ys[i]))[1]); } se = jk(th); }
      else { // grouped jackknife with 100 random-but-deterministic groups
        const G = 100, th = []; const gi = (ev) => { let h = 0; for (const ch of ev) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % G; };
        for (let g = 0; g < G; g++) { const ix = rows.map((r, i) => (gi(r.ev) !== g ? i : -1)).filter((i) => i >= 0); th.push(irls(ix.map((i) => xs[i]), ix.map((i) => ys[i]))[1]); } se = jk(th); }
      const cells = [];
      for (let k = 0; k < 10; k++) {
        const br = rows.filter((r) => Math.min(9, Math.floor(r.mid * 10)) === k);
        if (br.length < 10) { cells.push("-"); continue; }
        const j = jkMean(br, (r) => r.y - r.mid);
        cells.push(`${c1(j.mean)} (${c1(j.se)}) n${br.length}`);
        detail.push({ s, k, n: br.length, dev: j.mean, se: j.se });
      }
      P(`| ${s} | ${evs.length} | ${rows.length} | ${b.toFixed(3)} (${f2(se)}) | ${a.toFixed(3)} | ${cells.join(" | ")} |`);
    }
    if (X === 5) {
      P("\nBands with |dev|/SE >= 2 (n >= 30), T-5:\n");
      for (const d of detail.filter((d) => Math.abs(d.dev / d.se) >= 2 && d.n >= 30).sort((a, b) => Math.abs(b.dev / b.se) - Math.abs(a.dev / a.se))) P(`- ${d.s} band ${d.k / 10}-${(d.k + 1) / 10}: ${c1(d.dev)}c (SE ${c1(d.se)}), n=${d.n}`);
    }
  }

  // ---- rules ----
  const fee = (p, m) => 0.07 * m * p * (1 - p);
  const rules = [
    ["R1 buy fav YES @ask in [.70,.95]", (r) => (r.a >= 0.70 && r.a <= 0.95 && !r.tie ? { cost: r.a, win: r.y } : null)],
    ["R2 buy NO @1-bid, bid in [.03,.15]", (r) => (r.b >= 0.03 && r.b <= 0.15 && !r.tie ? { cost: 1 - r.b, win: 1 - r.y } : null)],
    ["S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45]", (r) => (r.sport === "Soccer" && r.tie && r.b >= 0.15 && r.b <= 0.45 ? { cost: 1 - r.b, win: 1 - r.y } : null)],
  ];
  P(`\n## Pre-registered rules at T-5 min, per contract, cents (gross = before fee; net = after taker fee). SE = delete-one-event jackknife of mean net.\n`);
  P("| rule | sport | half | n | events | mean cost | gross | net | net SE | net ROI% |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const [name, fn] of rules) {
    for (const s of ["ALL", ...sports]) for (const h of [1, 2, 0]) {
      const rows = [];
      for (const r of obs[5]) { if ((s !== "ALL" && r.sport !== s) || (h && r.half !== h)) continue; const t = fn(r); if (t) rows.push({ ev: r.ev, cost: t.cost, g: t.win - t.cost, n: t.win - t.cost - fee(t.cost, r.fee) }); }
      if (rows.length < 15) continue;
      const j = jkMean(rows, (r) => r.n); const g = rows.reduce((s2, r) => s2 + r.g, 0) / rows.length, cost = rows.reduce((s2, r) => s2 + r.cost, 0) / rows.length;
      P(`| ${name} | ${s} | ${h === 1 ? "Jul-Aug" : h === 2 ? "Sep-Oct" : "both"} | ${rows.length} | ${j.ev} | ${cost.toFixed(3)} | ${c1(g)} | ${c1(j.mean)} | ${c1(j.se)} | ${(100 * j.mean / cost).toFixed(1)} |`);
    }
  }
  // soccer favourite detail
  P("\n## Soccer favourites (3-way events, non-TIE markets), T-5: realised vs mid and vs ask\n");
  P("| mid band | n | events | mean mid | mean ask | realised | real - mid (SE) | real - ask (SE) |\n|---|---|---|---|---|---|---|---|");
  for (const [lo, hi] of [[0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1], [0.7, 1], [0.6, 1]]) {
    const rows = obs[5].filter((r) => r.sport === "Soccer" && !r.tie && r.mid >= lo && r.mid < hi);
    if (rows.length < 10) continue;
    const a = jkMean(rows, (r) => r.y - r.mid), b = jkMean(rows, (r) => r.y - r.a);
    P(`| ${lo}-${hi} | ${rows.length} | ${a.ev} | ${f2(rows.reduce((s, r) => s + r.mid, 0) / rows.length)} | ${f2(rows.reduce((s, r) => s + r.a, 0) / rows.length)} | ${f2(rows.reduce((s, r) => s + r.y, 0) / rows.length)} | ${c1(a.mean)} (${c1(a.se)}) | ${c1(b.mean)} (${c1(b.se)}) |`);
  }
  console.log(out.join("\n"));
}
