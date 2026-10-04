# Kalshi sheaf layer, 2026-10-04 (research and shadow only; no orders)

Spectral / sheaf-theoretic layer over the daily-temperature ladders. The within-ladder Dutch-book LP lives in
`../2026-10-04-kalshi-coherence` (src/coherence*.mjs) and is not duplicated: this layer treats each ladder as
one local section and studies how sections glue ACROSS ladders.

Code: `src/kalshi-sheaf.mjs` (cellular sheaf, weighted sheaf Laplacian, Dirichlet energy and per-edge
decomposition, harmonic extension, Jacobi spectrum, fitted calibration links; hand-written dense algebra),
`src/kalshi-sheaf-market.mjs` (market graph), `scripts/kalshi-sheaf-{fetch,backtest,evaluate,live}.mjs`,
`test/kalshi-sheaf.test.mjs` (7 tests: path interpolation, ker L = H^0, twisted cycle has no global section,
scale restriction, energy decomposition, link fit, ladder fit). Reproduce: fetch -> backtest `<dataDir> <split>` -> evaluate -> live.
Data: `data-long/` (settled markets and hourly candles, 48 series, 2026-07-27..10-02) (fetch script default dir is `data/`; pass `data-long` and a 2026-07-01 min-close).

## The sheaf (house vocabulary)
- Vertex = a ladder (station, high|low, date); local section = Normal fitted to the bracket mids (the within-fibre
  misfit is the local incoherence). Stalk R^2 = (mean anomaly vs trailing 14-day settled mean, log-scale anomaly).
- Edge = linkage, edge stalk R^2 with metric W = inverse residual covariance of the calibration link kappa:
  neighbouring stations same day (3-nearest, 24 stations), high vs low same station-day, lag-1 live ladder, lag-2 settled
  value (clamped). Restriction F_u = B (OLS, ridge-shrunk to its class), F_v = I. Kalshi<->Polymarket (identity link) and
  week/month aggregates are supported by the code but absent from this data.
- delta x(e) = F_v x_v - F_u x_u; L = delta^T W delta; global sections H^0 = ker delta = ker L; the Dirichlet energy
  x^T L x is the gluing defect; harmonic extension clamps liquid stalks and minimises energy on thin ones.
- Size per snapshot: about 120-145 vertices, 164-212 edges, 240-290 coordinates; 175 fitted links.

## Results (train 2026-08-13..09-07, test 09-08..10-02, two snapshot times S1 20Z D-1, S2 02Z D; day-cluster 95% CIs)
Full tables: `results/backtest.md`; signals `results/signals.csv`; energies/tension `results/energy-by-day.json`;
current read `results/live-shadow.md`.
- Brier on thin brackets (bottom liquidity tercile per kind, others clamped), test: market mid 0.107 (S1) / 0.101 (S2);
  harmonic 0.142 / 0.136; difference +0.035 [0.029,0.043] / +0.036 [0.028,0.044]. Harmonic is WORSE. Leave-one-out over all
  ladders: +0.049 / +0.054. A train-fitted blend weight (0.28 thin, 0.09 loo) gives no out-of-sample gain
  (+0.0016 [-0.0002,0.0031] thin S1; loo slightly worse).
- Level test (settled temp - ladder mean regressed on harmonic - ladder mean), test: slope 0.004 [-0.03,0.04] (S1),
  -0.005 [-0.03,0.03] (S2). RMSE: ladder mean 1.7 / 1.6 F, harmonic 3.9 F, trailing climatology 5.8 F.
  The sheaf transfer beats climatology but carries nothing beyond the ladder.
- Market does not move toward the harmonic estimate (slope of S1->S2 mid change on residual: 0.005).
- Taker EV after fee (10-lot, spread <=6c, bracket traded >=100 contracts in prior 3h; top-of-book depth is NOT in
  candles, so size is assumed): thin, test, threshold 7c: S1 -7.0c [-15.2,+1.5] (79 trades), S2 -0.1c [-5.0,+5.6] (121);
  loo, test: -3.5c / -3.4c, CI excluding zero. Train thin S1 looked positive (+6.5c at 7c) and reversed out of sample.
- Energy: in sample the per-edge Dirichlet energy is ~1.8 (chi-square, 2 dof, as constructed); out of sample 10.2 (S1) /
  7.7 (S2): the fitted gluing does not survive the autumn cooling regime (no intercept, lagging baseline). Daily energy vs
  market error: Spearman -0.30 (not a risk gauge). Spectrum (2026-10-02, 206 live coordinates): no global sections on the
  connected part (kernel = 34 isolated coordinates only), 10 softest modes 2e-4..8e-4, top 1247; the 12 softest modes carry
  0.5 of 4269 energy, so the defect is local, not a persistent soft mode.
- Tension concentrates at western coastal links (SAN low vs PHX/LAX/LAS, 2026-10-02: 5 SAN-low edges hold 53% of the 4275 energy) and
  at the Gulf/Texas high links (HOU-SAT, AUS); these are ladders disagreeing with their neighbours on fitted-linear terms.

## Interpretation and honesty
Gluing obstruction: with W-weighted non-identity restrictions the sheaf has H^0 = 0 on the connected part, so no market
state is a global section; the energy is the norm of the H^1 representative (what cannot be glued), and the
per-edge decomposition localises it. Fiber algebra: each ladder is a fibre carrying a bounded value set; the fitted B are
the calibration links kappa between fibres. This is a Gaussian Markov random field in sheaf dress: the harmonic
extension is the MAP/kriging estimate, and the house contribution is the structure (clamping, local-to-global, tension
by edge, spectrum), not new statistics.
- Edge: none found. The markets already price the neighbours; harmonic residuals have no predictive value on 51 days, 12k
  brackets, and the market does not converge to them.
- Descriptive only: tension and energy maps (where do ladders disagree with the neighbourhood, e.g. stale or
  mis-set ladders, regime breaks), spectrum, and detection of baseline drift (energy 1.8 -> 7-10).
- Limits: 8 weeks, one season, cooling regime shift; Normal ladder shape; trailing-mean baseline; fills assumed from candle
  volume; live read uses a single quote per market.
- Verdict: a "harmonic thin-market" lane is NOT worth shadowing as a trade signal. Worth keeping as a monitor (tension map
  as ladder-staleness / data-fault flag), and worth revisiting only with markets where thinness is real (new or illiquid
  series, Kalshi<->Polymarket identity links, week/month aggregate links) where a clamped neighbour is the only information.
