import {weatherIndexBinding} from './weather-index.mjs';
import { createHash } from 'node:crypto';
import { temperatureSeries, eventDate } from './temperature-market-model.mjs';
import { rainCityCode, rainCity } from './rain-market-model.mjs';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function mapLimit(rows, limit, fn) {
  const out = new Array(rows.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, rows.length)}, async () => {
    while (next < rows.length) { const at = next++; out[at] = await fn(rows[at], at); }
  }));
  return out;
}
export function weatherRuleKey(market,seriesTicker,source,station) {
  // Dates and rung numbers vary; measurement/source/revision rules must never share skill after changing.
  const template=(`${market.rules_primary??''}\n${market.rules_secondary??''}`)
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},\s*)?\d{4}\b/gi,'{date}')
    .replace(/((?:greater than|less than|above|below)\s+)-?\d+(?:\.\d+)?(?=°| inches)/gi,'$1{strike}')
    .replace(/(between\s+)-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?(?=°)/gi,'$1{range}')
    .replace(/\s+/g,' ').trim();
  return digest({series:seriesTicker,source,station,strike:market.strike_type,template});
}
export function weatherContract(market, series) {
  const rules = `${market.rules_primary ?? ''}\n${market.rules_secondary ?? ''}`;
  const title = `${series.title} ${market.title}`;
  const source = /Synoptic/i.test(rules) ? 'synoptic' : /Weather Company|weather\.com\/kalshi/i.test(rules) ? 'twc' : /National Weather Service|NWS|Climate Report/i.test(rules) ? 'nws-cli' : /National Hurricane Center|NHC/i.test(rules) ? 'nhc' : null;
  const stationRule = /\bCLI[A-Z0-9]{3}\b/.exec(rules)?.[0] ?? null;
  let family = /hurricane|tropical storm/i.test(title) ? 'tropical' : /snow|ski|opening|closing/i.test(title) ? 'snow' : /rain|precipitation/i.test(title) ? 'precipitation' : /temp|heat|hottest/i.test(title) ? 'temperature' : 'other';
  let binding = null;
  const t = temperatureSeries(series.ticker);
  const date = eventDate(market.event_ticker);
  if (t && date) {
    family = 'daily-temperature';
    if (stationRule === t.climateReport && ['twc','nws-cli'].includes(source) && /fahrenheit/i.test(rules)) binding = {...t, targetDate: date, source, proxy: source !== 'nws-cli'};
  } else if (series.ticker === 'KXRAIN') {
    family = 'daily-rain'; const city = rainCity(rainCityCode(market.ticker));
    if (city && date && stationRule === city.cli && source === 'twc' && /strictly greater than 0 inches/i.test(rules)) binding = {...city, timeZone:city.zone, targetDate:date, source, kind:'rain', climateReport:city.cli, proxy:true};
  } else if (series.frequency === 'hourly' && family === 'temperature') {family = 'hourly-temperature';binding=weatherIndexBinding(market,series);}
  const baseRuleKey = weatherRuleKey(market,series.ticker,source,stationRule);
  const ruleKey=binding?.kind==='index-at'?digest({baseRuleKey,methodology:binding.methodologyUrl,revision:binding.seriesRevision}):baseRuleKey;
  return {...market, seriesTicker:series.ticker, feeType:series.fee_type, feeMultiplier:series.fee_multiplier, family, source, stationRule, binding, ruleKey,
    blocker: binding ? null : !source ? 'settlement source is not bound' : `${family}: station, measurement window and validated model need binding`};
}
/** Census every listed weather series. A failed page is visible and cannot become an empty universe. */
export async function discoverWeather(client) {
  const series = []; let cursor;
  for (let page=0; page<50; page++) {
    const p = await client.call('GET','/series',{signed:false,query:{category:'Climate and Weather',limit:200,cursor}});
    series.push(...p.series ?? []); cursor=p.cursor;
    if (!cursor) break;
    if (page===49) throw new Error('weather series pagination incomplete');
  }
  const unique = [...new Map(series.map(s=>[s.ticker,s])).values()]; const errors=[];
  const sets = await mapLimit(unique, 3, async s => {
    try { return (await client.getMarkets({series_ticker:s.ticker,status:'open'})).map(m=>weatherContract(m,s)); }
    catch(e) { errors.push({series:s.ticker,error:e.message}); return []; }
  });
  return {series:unique.length, markets:sets.flat(), errors, complete:errors.length===0};
}
