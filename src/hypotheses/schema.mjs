/**
 * Hypothesis schema. A hypothesis is a pre-registered, falsifiable trading claim stored as data
 * (content/hypotheses/<id>.json) and validated on load. Everything a verdict needs is in the file; the only
 * code a file may name is an `evaluator` from the registry in evaluators.mjs.
 *
 *   id, title, record            identity and the record whose prose pre-registered the rule
 *   registeredAt                 ISO instant; no observation earlier than this may be judged
 *   status                       forward | holdout | killed | passed | admitted
 *   universe                     { series: [ticker...] }
 *   entry                        declarative rule (below), or null when an evaluator owns entry
 *   cluster                      event | game | day | week : the independent unit for errors
 *   fee                          { theta, multiplier: 'series' | number, count, rounding: 'cent-per-order' | 'none' }
 *   verdict                      { minClusters, k, refuteK?, maxClusters?, holdout?, comparison? }
 *   evaluator, params            optional bespoke pure function and its parameters
 *   judgeAfter                   ISO instant before which no reading is told (re-run dates)
 *   killed                       { at, reason, numbers } for status killed
 *
 * entry = {
 *   snapshot: { anchor: 'close' | 'start', offsetMinutes, toleranceMinutes },   offset < 0 is before the anchor
 *   side: 'yes' | 'no',                      the contract bought; fills at yes_ask (yes) or 1 - yes_bid (no)
 *   price: { field: 'fill' | 'yes_ask' | 'yes_bid' | 'yes_mid', min?, max? },   band, inclusive
 *   choose: 'all' | { nearest: { field: 'yes_mid', target } },
 *   oncePer: 'market' | 'event',
 *   hold: 'settlement'
 * }
 */
export const STATUSES = Object.freeze(['forward', 'holdout', 'killed', 'passed', 'admitted']);
export const CLUSTERS = Object.freeze(['event', 'game', 'day', 'week']);
export const ANCHORS = Object.freeze(['close', 'start']);
export const PRICE_FIELDS = Object.freeze(['fill', 'yes_ask', 'yes_bid', 'yes_mid']);

const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export class HypothesisSchemaError extends Error {
  constructor(id, errors) { super(`hypothesis ${id ?? '?'}: ${errors.join('; ')}`); this.errors = errors; }
}

/** @returns {string[]} the schema errors of a hypothesis object; empty when valid */
export function schemaErrors(h, { evaluators = null } = {}) {
  const e = [];
  const need = (ok, msg) => { if (!ok) e.push(msg); };
  need(h && typeof h === 'object', 'not an object');
  if (!h || typeof h !== 'object') return e;
  need(typeof h.id === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(h.id), 'id must be kebab-case');
  need(typeof h.title === 'string' && h.title.length > 0, 'title required');
  need(isIso(h.registeredAt), 'registeredAt must be an ISO instant');
  need(STATUSES.includes(h.status), `status must be one of ${STATUSES.join('|')}`);
  need(Array.isArray(h.universe?.series) && h.universe.series.every((s) => typeof s === 'string'), 'universe.series must be a list of series tickers');
  need(CLUSTERS.includes(h.cluster), `cluster must be one of ${CLUSTERS.join('|')}`);
  if (h.judgeAfter !== undefined) need(isIso(h.judgeAfter), 'judgeAfter must be an ISO instant');
  if (h.status === 'killed') need(h.killed && isIso(h.killed.at) && typeof h.killed.reason === 'string', 'killed needs {at, reason, numbers}');
  const f = h.fee;
  need(f && isNum(f.theta) && (f.multiplier === 'series' || isNum(f.multiplier)) && Number.isInteger(f.count) && f.count >= 1 && ['cent-per-order', 'none'].includes(f.rounding), 'fee needs theta, multiplier, integer count, rounding');
  const v = h.verdict;
  need(v && Number.isInteger(v.minClusters) && v.minClusters >= 2 && isNum(v.k), 'verdict needs integer minClusters >= 2 and numeric k');
  if (v?.refuteK !== undefined) need(isNum(v.refuteK), 'verdict.refuteK numeric');
  if (v?.maxClusters !== undefined) need(Number.isInteger(v.maxClusters) && v.maxClusters >= v.minClusters, 'verdict.maxClusters >= minClusters');
  if (v?.holdout !== undefined) need(v.holdout.lastMonth === true || isIso(v.holdout.from), 'verdict.holdout needs lastMonth or from');
  if (v?.comparison !== undefined) need(typeof v.comparison.arm === 'string' && typeof v.comparison.against === 'string' && isNum(v.comparison.k), 'verdict.comparison needs arm, against, k');
  if (h.evaluator !== undefined) {
    need(typeof h.evaluator === 'string', 'evaluator must be a name');
    if (evaluators) need(Object.hasOwn(evaluators, h.evaluator), `unknown evaluator ${h.evaluator}`);
  }
  if (h.entry === null || h.entry === undefined) need(typeof h.evaluator === 'string' || h.status === 'killed', 'a live hypothesis without entry needs an evaluator');
  else {
    const en = h.entry, s = en.snapshot;
    need(s && ANCHORS.includes(s.anchor) && isNum(s.offsetMinutes) && isNum(s.toleranceMinutes) && s.toleranceMinutes > 0, 'entry.snapshot needs anchor, offsetMinutes, toleranceMinutes > 0');
    need(['yes', 'no'].includes(en.side), 'entry.side yes|no');
    need(en.price && PRICE_FIELDS.includes(en.price.field) && (en.price.min === undefined || isNum(en.price.min)) && (en.price.max === undefined || isNum(en.price.max)), 'entry.price needs a field and numeric bounds');
    need(en.choose === 'all' || (isNum(en.choose?.nearest?.target) && en.choose.nearest.field === 'yes_mid'), "entry.choose is 'all' or {nearest:{field:'yes_mid',target}}");
    need(['market', 'event'].includes(en.oncePer), 'entry.oncePer market|event');
    need(en.hold === 'settlement', "entry.hold must be 'settlement'");
  }
  return e;
}

/** Validate on load; throws HypothesisSchemaError. */
export function validateHypothesis(h, options) {
  const errors = schemaErrors(h, options);
  if (errors.length) throw new HypothesisSchemaError(h?.id, errors);
  return h;
}
