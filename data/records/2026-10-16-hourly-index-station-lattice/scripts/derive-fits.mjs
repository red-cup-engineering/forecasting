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
 * Also `maxStakeFraction` and its basis, from the same scores: fractional Kelly with a haircut for the estimation error of
 * the edge (src/policy-derivation.mjs stakeCap). Derivation owns only the keys it writes; every other key of the policy
 * (and of each city, lead and side) is kept as it stands, so a hand-written key survives a rederivation.
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
import { tolerancesOf, stakeCap, mergeLeads } from '../../../../../../src/policy-derivation.mjs';

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
const scored = [];
for (const city of cities) {
  const c = await read(join(results, `calibration-${city}.json`)), market = await read(join(results, `market-${city}.json`));
  scored.push(...Object.values(market.byLeadMinutes));
  policy.calibrationEdges = c.edges;
  const sides = Object.fromEntries(Object.entries(c.buckets).map(([bucket, bySide]) => [bucket, Object.fromEntries(Object.entries(bySide).map(([side, s]) => [side, {
    calibration: s.calibration,
    bands: s.bands.map((b, i) => {
      const settled = side === 'yes' ? i === s.bands.length - 1 : i === 0;
      return { from: b.from, to: b.to, marginCents: settled ? b.marginCents : null, heldUpMarginCents: b.marginCents, settledInAdvance: settled,
        heldOut: b.folds.map((f) => ({ marginCents: f.marginCents, centsPerContract: f.heldCentsPerContract ?? null, contracts: f.heldContracts ?? 0 })) };
    }),
  }]))]));
  policy.cities[city] = mergeLeads(policy.cities[city], sides, tolerancesOf(market));
}
// The stake cap. The Miami incident that first bounded it (2026-10-17) stays in the policy as maxStakeFractionIncident.
const cap = stakeCap(scored);
if (typeof policy.maxStakeFractionBasis === 'string' && policy.maxStakeFractionIncident === undefined) policy.maxStakeFractionIncident = policy.maxStakeFractionBasis;
policy.maxStakeFraction = cap.cap;
policy.maxStakeFractionBasis = { derivedBy: 'scripts/derive-fits.mjs, src/policy-derivation.mjs stakeCap', rule: 'fractional Kelly with an estimation-error haircut: cap = k e, e the largest edge led on without observation (one RMS model error s), k = e^2 / (e^2 + s^2)', ...cap, buckets: scored.length };
policy.derivedFrom = `forecasting-service/data/records/${record}`;
await writeFile(policyFile, JSON.stringify(policy, null, 2) + '\n');
process.stdout.write(`wrote ${Object.keys(fit.cities).length} city fits and their lead policies\n`);
