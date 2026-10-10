/**
 * The house's far-tail prediction for one Kalshi daily-temperature bracket: whether the bracket is a far tail
 * the fitted NBM model is measured to certify, and the loss rate a bet against it is sized on.
 *
 * The model loses to Kalshi's mid overall but is a measured specialist at the far tails
 * (content/config/temperature-markets.json `tails`). This module states only the weather: the model's
 * probability, the side of the forecast the bracket lies on, whether the hour is inside the measured decision
 * window, whether an NWS temperature hazard is active on that side, and the per-settlement-day posterior loss
 * rate. What the bracket is worth at a price, net of Kalshi's fee, is the desk's. Pure apart from the
 * configuration read at load.
 */
import { TEMPERATURE_MARKETS, priceTemperatureBracket } from './temperature-market-model.mjs';

export const TAILS = TEMPERATURE_MARKETS.tails;

/** The side of the forecast a bracket lies on: `warm` when it starts above the model's mean, `cold` when it ends below it, null when it straddles the mean. */
export function tailSide({ floorStrike, capStrike }, mean) {
  if (Number.isFinite(floorStrike) && floorStrike > mean) return 'warm';
  if (Number.isFinite(capStrike) && capStrike < mean) return 'cold';
  return null;
}

/** No tail is eligible on the side of an active NWS temperature hazard, nor where the station's hazards could not be read. */
export function regimeVerdict(side, hazards) {
  if (hazards === null || hazards === undefined) return { ok: false, reason: 'NWS hazards unread at the station' };
  const active = side === 'warm' ? hazards.warm : side === 'cold' ? hazards.cold : [];
  if (active.length > 0) return { ok: false, reason: `${side} tail under ${active.join(', ')}` };
  return { ok: true };
}

/** Whether `now` is inside the measured decision window for an event of this kind and date in the station's zone. */
export function inDecisionWindow({ kind, targetDate, timeZone }, windows = TAILS.windows, now = Date.now()) {
  const local = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const today = `${local.year}-${local.month}-${local.day}`;
  const minutes = Number(local.hour) * 60 + Number(local.minute);
  const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const dayBefore = new Date(Date.parse(`${targetDate}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const window = windows[kind];
  if (today === dayBefore) return minutes >= at(window.dayBeforeFrom) && (window.dayBeforeUntil === undefined || minutes < at(window.dayBeforeUntil));
  if (today === targetDate) return window.sameDayUntil !== undefined && minutes < at(window.sameDayUntil);
  return false;
}

/** The loss rate a bet against a certified tail is sized on: the larger of the model's probability and the per-settlement-day posterior mean. */
export function tailLossRate(probability, kind, posterior = TAILS.lossRatePosterior) {
  const evidence = posterior[kind];
  return Math.max(probability, (evidence.losses + 1) / (evidence.clusters + 2));
}

/**
 * The tail prediction for one bracket.
 * @param {{seriesTicker: string, eventTicker: string, strikeType: string, floorStrike?: number, capStrike?: number}} market
 * @param {{guidance: object, observed?: object|null, hazards: {warm: string[], cold: string[]}|null, timeZone: string, now?: number, maxGuidanceAgeHours?: number, rules?: object}} evidence
 * @returns {{eligible: true, probability: number, lossRate: number, side: 'warm'|'cold', priced: object} | {eligible: false, reason: string, priced?: object}}
 */
export function predictTemperatureTail(market, { guidance, observed = null, hazards, timeZone, now = Date.now(), maxGuidanceAgeHours = 8, rules = TAILS }) {
  const priced = priceTemperatureBracket(market, { guidance, observed, maxGuidanceAgeHours, now });
  if (!priced.priced) return { eligible: false, reason: priced.reason };
  if (!inDecisionWindow({ kind: priced.kind, targetDate: priced.targetDate, timeZone }, rules.windows, now)) return { eligible: false, reason: 'outside the measured decision window', priced };
  const maxP = rules.maxModelProbability[priced.kind];
  if (!(priced.probability <= maxP)) return { eligible: false, reason: `model p ${priced.probability.toFixed(4)} above the ${maxP} tail threshold`, priced };
  const side = tailSide(market, priced.mean);
  if (!side) return { eligible: false, reason: 'bracket straddles the forecast mean', priced };
  const regime = regimeVerdict(side, hazards);
  if (!regime.ok) return { eligible: false, reason: regime.reason, priced };
  return { eligible: true, probability: priced.probability, lossRate: tailLossRate(priced.probability, priced.kind, rules.lossRatePosterior), side, priced };
}
