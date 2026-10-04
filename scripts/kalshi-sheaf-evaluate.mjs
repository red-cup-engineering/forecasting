// Score the harmonic estimates in signals.csv: Brier vs market mid, and after-fee EV of edge trades.
// usage: node scripts/kalshi-sheaf-evaluate.mjs <resultsDir>
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve(process.argv[2]);
const lines = fs.readFileSync(path.join(dir, "signals.csv"), "utf8").trim().split("\n");
const cols = lines[0].split(",");
const R = lines.slice(1).map((l) => { const v = l.split(","); const o = {}; cols.forEach((c, i) => { o[c] = isNaN(+v[i]) || v[i] === "" ? v[i] : +v[i]; }); return o; });
const fee10 = (p) => Math.ceil(0.07 * 10 * p * (1 - p) * 100 - 1e-9) / 100 / 10;
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function clusterBoot(rowsOfDay, stat, B = 600) {
  const days = [...rowsOfDay.keys()]; const out = [];
  for (let b = 0; b < B; b++) { const pick = []; for (let i = 0; i < days.length; i++) pick.push(...rowsOfDay.get(days[Math.floor(rnd() * days.length)])); out.push(stat(pick)); }
  out.sort((a, b) => a - b); return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
const byDay = (rows) => { const m = new Map(); for (const r of rows) (m.get(r.day) ?? m.set(r.day, []).get(r.day)).push(r); return m; };
const brier = (rows, k) => mean(rows.map((r) => (r[k] - r.y) ** 2));
const fitW = (rows, k) => { let n = 0, d = 0; for (const r of rows) { n += (r.y - r.mid) * (r[k] - r.mid); d += (r[k] - r.mid) ** 2; } return Math.min(1, Math.max(0, n / d)); };
const out = [];
const P = (s) => { out.push(s); console.log(s); };

P("## Brier: harmonic estimate vs market mid (lower is better); d = Brier(model) - Brier(mid), 95% day-cluster CI");
P("| S | mode | split | n brackets | days | mid | pM (own Normal) | pA harmonic(mu,sigma) | d(pA) [CI] | pB harmonic mu, own sigma | d(pB) [CI] | w_A | blend(wA) d [CI] |");
P("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const S of ["S1", "S2"]) for (const mode of ["thin", "loo"]) {
  const sub = R.filter((r) => r.S === S && r.mode === mode);
  const train = sub.filter((r) => r.split === "train"), wA = fitW(train, "pA"), wB = fitW(train, "pB");
  for (const split of ["train", "test"]) {
    const rows = sub.filter((r) => r.split === split); if (!rows.length) continue;
    const bd = byDay(rows);
    const d = (k) => (rr) => brier(rr, k) - brier(rr, "mid");
    const blend = (rr) => mean(rr.map((r) => (r.mid + wA * (r.pA - r.mid) - r.y) ** 2)) - brier(rr, "mid");
    const f = (x) => x.toFixed(4), ci = (st) => { const c = clusterBoot(bd, st); return `${(st(rows)).toFixed(4)} [${c[0].toFixed(4)}, ${c[1].toFixed(4)}]`; };
    P(`| ${S} | ${mode} | ${split} | ${rows.length} | ${bd.size} | ${f(brier(rows, "mid"))} | ${f(brier(rows, "pM"))} | ${f(brier(rows, "pA"))} | ${ci(d("pA"))} | ${f(brier(rows, "pB"))} | ${ci(d("pB"))} | ${wA.toFixed(3)} | ${ci(blend)} |`);
  }
}
P("");
P("## Edge trades at the quote (taker, 10-lot fee, one contract-equivalent), signal = harmonic pA vs ask/bid");
P("fill rule: spread <= 6c, trailing-3h volume in the bracket >= 100 contracts (top-of-book depth is not in candles, so a 10-lot at the quote is ASSUMED fillable only when the bracket is actively trading); +1c slippage variant shown.");
P("| S | mode | split | threshold | trades | per-day avg trades | EV/contract (c) [95% CI] | EV with +1c slip (c) | hit rate | buy-yes share |");
P("|---|---|---|---|---|---|---|---|---|---|");
for (const S of ["S1", "S2"]) for (const mode of ["thin", "loo"]) for (const split of ["train", "test"]) for (const tau of [0.04, 0.07, 0.10, 0.15]) {
  const rows = R.filter((r) => r.S === S && r.mode === mode && r.split === split && r.ask - r.bid <= 0.06 && r.recent >= 100);
  const T = [];
  for (const r of rows) {
    if (r.pA - r.ask >= tau && r.ask < 0.97) T.push({ day: r.day, ev: r.y - r.ask - fee10(r.ask), slip: -0.01, win: r.y === 1, yes: 1 });
    else if (r.bid - r.pA >= tau && r.bid > 0.03) T.push({ day: r.day, ev: r.bid - r.y - fee10(1 - r.bid), slip: -0.01, win: r.y === 0, yes: 0 });
  }
  if (T.length < 5) { P(`| ${S} | ${mode} | ${split} | ${tau} | ${T.length} | - | - | - | - | - |`); continue; }
  const bd = byDay(T); const st = (rr) => mean(rr.map((t) => t.ev)) * 100; const c = clusterBoot(bd, st);
  P(`| ${S} | ${mode} | ${split} | ${tau} | ${T.length} | ${(T.length / bd.size).toFixed(1)} | ${st(T).toFixed(2)} [${c[0].toFixed(2)}, ${c[1].toFixed(2)}] | ${(st(T) - 1).toFixed(2)} | ${(mean(T.map((t) => +t.win))).toFixed(3)} | ${mean(T.map((t) => t.yes)).toFixed(2)} |`);
}
P("");
P("## Residual sign diagnostic: does market move toward the harmonic estimate? (S1 -> S2 same event, LOO)");
{
  const s1 = new Map(R.filter((r) => r.S === "S1" && r.mode === "loo" && r.split === "test").map((r) => [r.ticker, r]));
  let n = 0, sxy = 0, sxx = 0; const pairs = [];
  for (const r of R.filter((r) => r.S === "S2" && r.mode === "loo" && r.split === "test")) { const a = s1.get(r.ticker); if (!a) continue; pairs.push([a.pA - a.mid, r.mid - a.mid]); }
  for (const [x, y] of pairs) { n++; sxy += x * y; sxx += x * x; }
  P(`slope of (mid_S2 - mid_S1) on (pA_S1 - mid_S1): ${(sxy / sxx).toFixed(3)} over ${n} bracket-pairs (1 = market closes the gap fully, 0 = ignores it)`);
}

P("");
P("## Level test: does the harmonic mean carry information about the settled temperature beyond the ladder mean? (LOO, one row per ladder)");
P("regress (settled - muM) on (muH - muM); slope 0 = nothing beyond the market, 1 = harmonic is the better mean. RMSE in degF.");
P("| S | split | ladders | RMSE muM | RMSE muH | RMSE trailing climatology | slope [95% CI] | RMSE muM + slope*(muH-muM) (train slope) |");
P("|---|---|---|---|---|---|---|---|");
const uniq = (rows) => { const seen = new Set(), o = []; for (const r of rows) { const k = r.S + r.id + r.day; if (!seen.has(k)) { seen.add(k); o.push(r); } } return o; };
for (const S of ["S1", "S2"]) {
  const base = uniq(R.filter((r) => r.S === S && r.mode === "loo" && r.val !== "" && !Number.isNaN(r.val)));
  const slope = (rr) => { let n = 0, d = 0; for (const r of rr) { n += (r.val - r.muM) * (r.muH - r.muM); d += (r.muH - r.muM) ** 2; } return n / d; };
  const bT = slope(base.filter((r) => r.split === "train"));
  for (const split of ["train", "test"]) {
    const rr = base.filter((r) => r.split === split); if (!rr.length) continue;
    const rm = (f) => Math.sqrt(mean(rr.map((r) => (r.val - f(r)) ** 2)));
    const c = clusterBoot(byDay(rr), slope);
    P(`| ${S} | ${split} | ${rr.length} | ${rm((r) => r.muM).toFixed(3)} | ${rm((r) => r.muH).toFixed(3)} | ${rm((r) => r.clim).toFixed(3)} | ${slope(rr).toFixed(3)} [${c[0].toFixed(3)}, ${c[1].toFixed(3)}] | ${rm((r) => r.muM + bT * (r.muH - r.muM)).toFixed(3)} |`);
  }
}
try {
  const en = JSON.parse(fs.readFileSync(path.join(dir, "energy-by-day.json"))).energyRows.filter((e) => e.S === "S1");
  const err = new Map();
  for (const r of uniq(R.filter((r) => r.S === "S1" && r.mode === "loo"))) { const a = err.get(r.day) ?? []; a.push(Math.abs(r.val - r.muM)); err.set(r.day, a); }
  const xs = [], ys = [];
  for (const e of en) if (err.has(e.day)) { xs.push(e.perEdgeMean); ys.push(mean(err.get(e.day))); }
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = []; o.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rx = rank(xs), ry = rank(ys), mx = mean(rx), my = mean(ry);
  const rho = rx.reduce((s, v, i) => s + (v - mx) * (ry[i] - my), 0) / Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0) * ry.reduce((s, v) => s + (v - my) ** 2, 0));
  P("");
  P(`Spearman(daily mean edge energy, daily mean |settled - muM|) over ${xs.length} days (S1): rho = ${rho.toFixed(3)}  (energy as a market-wide uncertainty/dislocation gauge)`);
} catch (e) { P("energy-vs-error skipped: " + e.message); }
fs.writeFileSync(path.join(dir, "backtest.md"), out.join("\n") + "\n");
