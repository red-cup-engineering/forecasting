import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hypothesesDir, loadHypotheses } from '../src/hypotheses/run.mjs';
import { HypothesisSchemaError, schemaErrors, validateHypothesis } from '../src/hypotheses/schema.mjs';
import { EVALUATORS } from '../src/hypotheses/evaluators.mjs';

const good = () => JSON.parse(readFileSync(join(hypothesesDir, 'claims-c1.json'), 'utf8'));

test('every shipped hypothesis validates on load', () => {
  const all = loadHypotheses();
  assert.equal(all.length, readdirSync(hypothesesDir).filter((f) => f.endsWith('.json')).length);
  const byId = Object.fromEntries(all.map((h) => [h.id, h.status]));
  for (const id of ['claims-c1', 'deep-terminal-dt', 'ncaaf-overs-o1', 'combo-flex-f1', 'weather-totals-r1', 'weather-totals-r2', 'weather-totals-r3', 'weather-totals-r4']) assert.equal(byId[id], 'forward');
  for (const id of ['late-favourite-r1', 'late-favourite-r2', 'crypto-midjoint-maker']) assert.equal(byId[id], 'killed');
});

test('schema errors name the broken field', () => {
  const h = good();
  assert.deepEqual(schemaErrors(h, { evaluators: EVALUATORS }), []);
  assert.match(schemaErrors({ ...h, registeredAt: 'soon' }).join(), /registeredAt/);
  assert.match(schemaErrors({ ...h, status: 'maybe' }).join(), /status/);
  assert.match(schemaErrors({ ...h, cluster: 'planet' }).join(), /cluster/);
  assert.match(schemaErrors({ ...h, fee: { theta: 0.07 } }).join(), /fee/);
  assert.match(schemaErrors({ ...h, verdict: { minClusters: 1, k: 2 } }).join(), /minClusters/);
  assert.match(schemaErrors({ ...h, entry: { ...h.entry, hold: 'exit' } }).join(), /hold/);
  assert.match(schemaErrors({ ...h, entry: null }).join(), /evaluator/);
  assert.match(schemaErrors({ ...h, entry: null, evaluator: 'no-such' }, { evaluators: EVALUATORS }).join(), /unknown evaluator/);
  assert.match(schemaErrors({ ...h, status: 'killed' }).join(), /killed/);
  assert.throws(() => validateHypothesis({ ...h, id: 'Bad Id' }), HypothesisSchemaError);
});
