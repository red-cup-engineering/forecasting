import {tailLossRate} from './temperature-tail-prediction.mjs';
import {poolProbabilities} from './probability-calibration.mjs';
/**
 * The house's price for one Kalshi daily-rain market (series KXRAIN): "total
 * precipitation at CLIxxx strictly greater than 0 inches" for a local day.
 *
 * The model is the 2026-10-04 weather-coverage record's, frozen
 * (content/config/rain-markets.json carries the coefficients and their
 * provenance): NBM's NBS P06 for the station's climate day is combined as
 * pany = 1 - prod(1 - P06) over the 6-hour periods whose midpoint lies in the
 * day, then recalibrated by a logistic on logit(pany), one pair of weights per
 * decision time. It is priced only on the calendar day before the event
 * (15:00 and 21:00 station-local), where it matches the market's own
 * calibration and is long-shot-corrected at both ends; on the day itself the
 * market sees the weather and beats the model, so nothing is priced then.
 *
 * Settlement: The Weather Company, trace counts as 0 inches, and the market
 * closes (resolves yes) the moment rain occurs. Pure: guidance is passed in
 * (src/nbm-station-guidance.mjs, which parses P06).
 */
import { readFileSync } from 'node:fs';
import { eventDate } from './temperature-market-model.mjs';

export const RAIN_MARKETS = JSON.parse(readFileSync(new URL('../content/config/rain-markets.json', import.meta.url), 'utf8'));
export const RAIN_SERIES = RAIN_MARKETS.series;

/** The city row for a KXRAIN city code (the ticker's last segment), or undefined. */
export const rainCity = (code) => RAIN_MARKETS.cities[code];
/** The city code of a KXRAIN market ticker (KXRAIN-26OCT04-BOS -> BOS), or null for any other series. */
export function rainCityCode(ticker) {
  const parts = String(ticker ?? '').split('-');
  return parts.length === 3 && parts[0] === RAIN_SERIES ? parts[2] : null;
}
export const rainEventTicker = (ticker) => String(ticker).slice(0, String(ticker).lastIndexOf('-'));
/** Every distinct NBS station the declared cities need. */
export const rainStations = ({ validatedOnly = false } = {}) => [...new Set(Object.values(RAIN_MARKETS.cities).filter((city) => !validatedOnly || city.validated).map((city) => city.station))];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const logit = (p, eps) => { const q = Math.min(1 - eps, Math.max(eps, p)); return Math.log(q / (1 - q)); };

/**
 * P(any rain over the climate day) from the combined NBS probability.
 * @param {number} pany  1 - prod(1 - P06/100)
 * @param {string} stage  "D-1 15h" or "D-1 21h"
 * @param {{fold?: "early"|"late"}} [options]  use one of the record's cross-fit halves (audit) instead of the frozen weights
 */
export function rainProbability(pany, stage, { fold } = {}) {
  const row = RAIN_MARKETS.decisionTimes[stage] ?? RAIN_MARKETS.decisionTimesUnused?.[stage];
  if (!row) throw new RangeError(`rain-market-model: no decision time ${stage}`);
  const [w0, w1] = fold ? row.crossFit[fold] : row.weights;
  return sigmoid(w0 + w1 * logit(pany, RAIN_MARKETS.eps));
}

/** The zone's standard-time (January) UTC offset in milliseconds for `year`: the NWS climate day follows local standard time all year. */
export function standardOffsetMs(zone, year) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(Date.UTC(year, 0, 15, 12))).find((p) => p.type === 'timeZoneName').value;
  const match = /GMT([+-])(\d\d):(\d\d)/u.exec(part);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/** UTC [start, end) of the local-standard-time calendar day `date` (YYYY-MM-DD) in `zone`, in epoch milliseconds. */
export function climateDayWindow(date, zone) {
  const [y, m, d] = date.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - standardOffsetMs(zone, y);
  return { start, end: start + 86400_000 };
}

const localParts = (zone, at) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};
const addDay = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/**
 * The decision stage `now` is in for an event date at a zone: the station-local
 * clock on the day before the event, 15:00-20:59 "D-1 15h", 21:00-23:59 "D-1 21h";
 * null at any other time (the model is not priced there).
 */
export function decisionStage({ targetDate, zone, now }) {
  const local = localParts(zone, now);
  if (local.date !== addDay(targetDate, -1)) return null;
  if (local.hour >= 21) return 'D-1 21h';
  if (local.hour >= 15) return 'D-1 15h';
  return null;
}

/** Combine the NBS P06 rows (percent) of the climate day: pany and the periods used. */
export function combinedRainProbability(rows, { date, zone }) {
  const { start, end } = climateDayWindow(date, zone);
  const used = rows.filter((row) => Number.isFinite(row.p06) && Date.parse(row.ftime) - 3 * 3600_000 > start && Date.parse(row.ftime) - 3 * 3600_000 < end);
  const dry = used.reduce((product, row) => product * (1 - row.p06 / 100), 1);
  return { pany: 1 - dry, periods: used.length, p06: used.map((row) => row.p06) };
}

/**
 * The probability one KXRAIN market settles yes, with everything it rests on.
 * @param {{ticker: string}} market
 * @param {{guidance: {stations: Record<string, object>, runtime: string}, maxGuidanceAgeHours?: number, now?: number}} evidence
 * @returns {{priced: true, probability: number, pany: number, stage: string, station: string, cli: string, region: string, city: string, targetDate: string, periods: number, p06: number[], runtime: string, leadHours: number, ageHours: number} | {priced: false, reason: string}}
 */
export function priceRainMarket(market, { guidance, maxGuidanceAgeHours = 8, now = Date.now() }) {
  const code = rainCityCode(market.ticker);
  if (!code) return { priced: false, reason: `${market.ticker} is not a ${RAIN_SERIES} market` };
  const city = rainCity(code);
  if (!city) return { priced: false, reason: `city ${code} is not declared` };
  if (!city.validated) return { priced: false, reason: `city ${code} (${city.station}) has no settled history in the model's fit` };
  const targetDate = eventDate(rainEventTicker(market.ticker));
  if (!targetDate) return { priced: false, reason: `${market.ticker} names no date` };
  const stage = decisionStage({ targetDate, zone: city.zone, now });
  if (!stage) return { priced: false, reason: `outside the day-before decision window for ${targetDate} (${city.zone})` };
  const ageHours = (now - Date.parse(guidance.runtime)) / 3600_000;
  if (!(ageHours <= maxGuidanceAgeHours)) return { priced: false, reason: `guidance run ${guidance.runtime} is ${ageHours.toFixed(1)}h old` };
  const station = guidance.stations[city.station];
  if (!station) return { priced: false, reason: `no NBS block for ${city.station} in run ${guidance.runtime}` };
  const { pany, periods, p06 } = combinedRainProbability(station.rows, { date: targetDate, zone: city.zone });
  if (periods < RAIN_MARKETS.minPeriods) return { priced: false, reason: `only ${periods} NBS P06 period(s) inside ${targetDate} for ${city.station} (need ${RAIN_MARKETS.minPeriods})` };
  return {
    priced: true, probability: rainProbability(pany, stage), pany, stage, station: city.station, cli: city.cli, region: city.region, city: city.name, targetDate,
    periods, p06, runtime: station.runtime ?? guidance.runtime, leadHours: (Date.parse(`${targetDate}T12:00:00Z`) - Date.parse(guidance.runtime)) / 3600_000, ageHours,
  };
}

/**
 * The side of the market's long-shot bias a priced rain market falls on, if either, and the loss rate a bet on that
 * side is sized on (rain-markets.json `sides`): `tail` (rain very unlikely: a NO holder's bet) or `favourite` (rain
 * near certain: a YES holder's bet). Never smaller than the model's own probability of losing.
 * @returns {{side: 'tail'|'favourite', lossRate: number} | null}
 */
export function rainSide(priced,sides=RAIN_MARKETS.sides,posteriors={}) {
  if (!priced?.priced) return null;
  if (priced.probability <= sides.tail.maxModelProbability) return { side: 'tail', lossRate:Math.max(priced.probability,posteriors.tail?.lossMean??tailLossRate(0,'tail',{tail:{losses:sides.tail.outOfSample.settledYes,clusters:sides.tail.outOfSample.markets}})) };
  if (priced.probability >= sides.favourite.minModelProbability) return { side: 'favourite', lossRate:Math.max(1-priced.probability,posteriors.favourite?.lossMean??tailLossRate(0,'favourite',{favourite:{losses:sides.favourite.outOfSample.settledNo,clusters:sides.favourite.outOfSample.markets}})) };
  return null;
}

/**
 * The market's own long-shot-corrected probability of rain, from its book: the mid read through the measured
 * recalibration (rain-markets.json `marketPrior`: P(yes | mid) = sigmoid(a + b logit(mid)), b ~ 1.22). A second opinion
 * beside the NBS model, independent of it; null without a two-sided book. It prices and sizes nothing.
 * @param {{bidCents: number|null, askCents: number|null}} book  best YES bid and ask in whole cents
 */
export function rainMarketPrior({ bidCents, askCents }, prior = RAIN_MARKETS.marketPrior) {
  if (!(bidCents >= 1 && askCents <= 99 && bidCents <= askCents)) return null;
  const mid = (bidCents + askCents) / 200;
  return { midCents: mid * 100, probability: sigmoid(prior.a + prior.b * logit(mid, RAIN_MARKETS.eps)), fit: { a: prior.a, b: prior.b } };
}

/** Supplementary forward experiment from the chronological daily-rain research. Never alters the frozen lane. */
export function rainMarketPoolProbability(weatherP,marketP){
  if(![weatherP,marketP].every(p=>Number.isFinite(p)&&p>=0&&p<=1))throw new TypeError('finite weather and market probabilities required');
  return poolProbabilities([weatherP,marketP].map(p=>Math.min(1-RAIN_MARKETS.eps,Math.max(RAIN_MARKETS.eps,p))),{method:'trimmed-logit-mean'});
}
export function priceRainPoolMarket(market,{guidance,marketProbability,now=Date.now()}={}){
  if(!guidance||!Number.isFinite(Date.parse(guidance.runtime))||now<Date.parse(guidance.runtime)||!Number.isFinite(marketProbability)||marketProbability<=0||marketProbability>=1)return null;
  let raw=priceRainMarket(market,{guidance,now});
  if(!raw.priced)return null;
  return {id:'nbm-market-rain-logit-pool-v1',p:rainMarketPoolProbability(raw.probability,marketProbability),details:{weatherProbability:raw.probability,marketProbability,stage:raw.stage,runtime:raw.runtime,p06:raw.p06,pooling:'equal log-odds with 0.001 endpoint clamp',research:'2026-10-04-weather-coverage',status:'forward experiment; historical pool selection was retrospective'}};
}
