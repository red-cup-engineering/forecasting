#!/usr/bin/env node
/**
 * Derive what the live market maker reads from this record's results, so no fitted number is copied by hand:
 *   - forecasting src/weather-index-lattice-fit.json: per city, the lattice parameters and the climatology priors
 *     (results/lattice-<city>.json);
 *   - Kalshi content/config/weather-market-making.json `cities.<city>.leads`: per lead bucket and quote side, the
 *     weather model's calibration given a fill of that side and the margin per band of the model's probability, null
 *     where the band did not hold up out of sample (results/calibration-<city>.json), with the calibration's bins in
 *     `calibrationEdges`, keeping the rest of that policy as it stands.
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
for (const city of cities) {
  const c = await read(join(results, `calibration-${city}.json`));
  policy.calibrationEdges = c.edges;
  policy.cities[city].leads = Object.fromEntries(Object.entries(c.buckets).map(([bucket, sides]) => [bucket, Object.fromEntries(Object.entries(sides).map(([side, s]) => [side, {
    calibration: s.calibration,
    bands: s.bands.map((b) => ({ from: b.from, to: b.to, marginCents: b.marginCents, heldOut: b.folds.map((f) => ({ marginCents: f.marginCents, centsPerContract: f.heldCentsPerContract ?? null, contracts: f.heldContracts ?? 0 })) })),
  }]))]));
}
policy.derivedFrom = `forecasting-service/data/records/${record}`;
await writeFile(policyFile, JSON.stringify(policy, null, 2) + '\n');
process.stdout.write(`wrote ${Object.keys(fit.cities).length} city fits and their lead policies\n`);
