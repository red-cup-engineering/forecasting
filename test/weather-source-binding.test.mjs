import test from 'node:test';
import assert from 'node:assert/strict';
import {authoritativeWeatherSource,weatherContract} from '../src/weather-universe.mjs';
import {INDEX_CITIES} from '../src/weather-index.mjs';

const primary=(source='The Weather Company')=>
 `Resolves Yes if the temperature recorded at Los Angeles, CA for Jul 24, 2026 10 PM EDT as reported by ${source} (for coordinates KLAX), is above 68.99°.`;
const notices='Effective September 10, 2026 settlement will change to Synoptic Data. Until then The Weather Company is authoritative.';
const market=(p,s='',over={})=>({
 ticker:'KXTEMPLAXH-26JUL2422-T68.99',event_ticker:'KXTEMPLAXH-26JUL2422',market_type:'binary',
 title:'Temperature in Los Angeles',strike_type:'greater',floor_strike:68.99,
 close_time:'2026-07-25T02:00:00Z',rules_primary:p,rules_secondary:s,...over,
});

test('the old hourly TWC contract remains TWC even when its warning names a later Synoptic migration',()=>{
 const m=market(primary(),notices),series={ticker:'KXTEMPLAXH',title:'Hourly temperature',frequency:'hourly'};
 assert.equal(authoritativeWeatherSource(m),'twc');
 const contract=weatherContract(m,series);
 assert.equal(contract.source,'twc');
 assert.equal(contract.family,'hourly-temperature');
 assert.equal(contract.binding,null,'single-station TWC is not silently recast as a weighted Kalshi index');
});

test('current official Synoptic index clause wins over references to nonauthoritative weather providers',()=>{
 const info=INDEX_CITIES.miami;
 const m=market('Resolves Yes if the temperature recorded at Miami, FL for Oct 14, 2026 at 10 AM EDT as reported by Synoptic Data, is above 82.99°.',
 'Official final value uses the Kalshi Weather Index Methodology. The Weather Company and National Weather Service are not authoritative.',
 {ticker:info.series+'-26OCT1410-T82.99',event_ticker:info.series+'-26OCT1410',floor_strike:82.99,
 close_time:'2026-10-14T14:05:00Z'});
 const series={ticker:info.series,title:'Hourly temperature',frequency:'hourly',
 contract_terms_url:`https://assets.kalshi.com/contract_terms/${info.terms}.pdf`};
 assert.equal(authoritativeWeatherSource(m),'synoptic');
 const contract=weatherContract(m,series);
 assert.equal(contract.source,'synoptic');
 assert.equal(contract.binding?.kind,'index-at');
 assert.equal(contract.binding.targetTime,'2026-10-14T14:00:00.000Z');
});

test('explicit daily NWS report prevails over competing provider names in informational warnings',()=>{
 const m=market('Resolves Yes if the maximum temperature for Oct 14, 2026 as reported by the National Weather Service\'s Climatological Report (Daily), is above 70°F.',
 'The Weather Company preliminary temperatures and Synoptic Data should not be used.');
 assert.equal(authoritativeWeatherSource(m),'nws-cli');
});

test('two contradictory publisher clauses refuse source identity instead of selecting a preferred name',()=>{
 const m=market('Result as reported by The Weather Company and according to Synoptic Data.');
 assert.equal(authoritativeWeatherSource(m),null);
 const contract=weatherContract(m,{ticker:'KXTEMPLAXH',title:'Hourly temperature',frequency:'hourly'});
 assert.equal(contract.source,null);
 assert.equal(contract.binding,null);
 assert.match(contract.blocker,/settlement source is not bound/);
});

test('without explicit authority a single unambiguous provider is recognized, mixed incidental providers are not',()=>{
 assert.equal(authoritativeWeatherSource(market('If the maximum temperature published in the NWS Climate Report is above 70°F')),'nws-cli');
 assert.equal(authoritativeWeatherSource(market('The reported temperature from Synoptic Data differs from the Weather Company')),null);
 assert.equal(authoritativeWeatherSource(market('No governing source is specified')),null);
});
