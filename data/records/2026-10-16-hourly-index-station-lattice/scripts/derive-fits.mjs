#!/usr/bin/env node
/**
 * Derive what the live market maker reads from this record's results, so no fitted number is copied by hand:
 *   - forecasting src/weather-index-lattice-fit.json: per city, the lattice parameters and the climatology priors
 *     (results/lattice-<city>.json);
 *   - Kalshi content/config/weather-market-making.json `cities.<city>.leads`: per lead bucket and quote side, the
 *     weather model's calibration given a fill of that side and the margin per band of the model's probability, null
 *     where the band did not hold up out of sample (results/calibration-<city>.json), with the calibration's bins in
 *     `calibrationEdges`, keeping the rest of that policy as it stands.
 *
 *   Also per lead bucket, `disagreementTolerance`: how far the model's probability may sit from the market's before the
 *   desk stops leaning on it (weather-quotes.mjs, soundness). Derived from the model's out-of-sample error against the
 *   market (results/market-<city>.json, scored on October after fitting on September), not chosen. Brier(model) -
 *   Brier(market) = E[(p - m)^2] + 2 E[(p - m)(m - y)]. If the market already holds what the model knows, the cross term
 *   is zero and the model's Brier excess is exactly its mean squared disagreement with the market, all of it model
 *   error. So one root-mean-square of that error, sqrt(max(0, Brier excess)), is the disagreement the model's own
 *   error explains; a larger one is read as the model lacking a term, not as edge. It is floored at one cent, Kalshi's
 *   price tick, below which prices do not disagree.
 *
 * Settled in advance first. The desk's cash goes first to what the weather has already settled within the hour: a
 * YES bid only where the model puts YES beyond doubt (its highest band), a NO bid only where it puts YES out of reach
 * (its lowest band). Those quotes turn over within the hour and carry the least risk. Every other band keeps its
 * held-out evidence (`heldOut`, `heldUpMarginCents`) and quotes nothing until that market making is working.
 *   node scripts/derive-fits.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), results = join(here, '..', 'results');
const record = '2026-10-16-hourly-index-station-lattice';
const forecasting = join(here, '..', '..', '..', '..'), kalshi = join(forecasting, '..', '..');
const cities = ['nyc', 'miami', 'chicago', 'la-coastal'];
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));

const fit = { record, cities: {} };
for (const city of cities) {
  const l = await read(join(results, `lattice-${city}.json`));
  fit.cities[city] = { fit: l.fit, params: l.params, climateDriftCPerMinuteByLocalHour: l.climateDriftCPerMinuteByLocalHour, climateVarianceC2PerMinuteByLocalHour: l.climateVarianceC2PerMinuteByLocalHour };
}
await writeFile(join(forecasting, 'src', 'weather-index-lattice-fit.json'), JSON.stringify(fit, null, 1) + '\n');

const policyFile = join(kalshi, 'content', 'config', 'weather-market-making.json'), policy = await read(policyFile);
const TICK = 0.01;
/** Per lead bucket, the model's root-mean-square error against the market, from its out-of-sample Brier scores. */
const toleranceOf = (market) => Object.fromEntries(Object.entries(market.byLeadMinutes).map(([bucket, r]) => [bucket, {
  disagreementTolerance: Math.round(1e4 * Math.max(TICK, Math.sqrt(Math.max(0, r.modelBrier - r.marketBrier)))) / 1e4,
  toleranceBasis: { window: market.window, contracts: r.contracts, modelBrier: r.modelBrier, marketBrier: r.marketBrier } }]));
for (const city of cities) {
  const c = await read(join(results, `calibration-${city}.json`)), tolerance = toleranceOf(await read(join(results, `market-${city}.json`)));
  policy.calibrationEdges = c.edges;
  policy.cities[city].leads = Object.fromEntries(Object.entries(c.buckets).map(([bucket, sides]) => [bucket, { ...policy.cities[city].leads?.[bucket], ...tolerance[bucket], ...Object.fromEntries(Object.entries(sides).map(([side, s]) => [side, {
    calibration: s.calibration,
    bands: s.bands.map((b, i) => {
      const settled = side === 'yes' ? i === s.bands.length - 1 : i === 0;
      return { from: b.from, to: b.to, marginCents: settled ? b.marginCents : null, heldUpMarginCents: b.marginCents, settledInAdvance: settled,
        heldOut: b.folds.map((f) => ({ marginCents: f.marginCents, centsPerContract: f.heldCentsPerContract ?? null, contracts: f.heldContracts ?? 0 })) };
    }),
  }]))}]));
}
policy.derivedFrom = `forecasting-service/data/records/${record}`;
await writeFile(policyFile, JSON.stringify(policy, null, 2) + '\n');
process.stdout.write(`wrote ${Object.keys(fit.cities).length} city fits and their lead policies\n`);
