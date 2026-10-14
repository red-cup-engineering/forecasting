import test from 'node:test';
import assert from 'node:assert/strict';
import {readHourlyIndexMarketCensus} from '../src/weather-engine.mjs';
import {INDEX_CITIES} from '../src/weather-index.mjs';

const at=Date.parse('2026-10-14T13:00:00Z');
const clock=()=>at;
const series=(city)=>({
  ticker:INDEX_CITIES[city].series,frequency:'hourly',title:'Hourly temperature',
  contract_terms_url:`https://assets.kalshi.com/contract_terms/${INDEX_CITIES[city].terms}.pdf`,
  fee_type:'quadratic',fee_multiplier:1,
});
const market=(city='miami',overrides={})=>({
  ticker:`${INDEX_CITIES[city].series}-26OCT14-T80`,
  event_ticker:`${INDEX_CITIES[city].series}-26OCT14`,
  series_ticker:INDEX_CITIES[city].series,
  market_type:'binary',status:'active',close_time:'2026-10-14T14:05:00Z',
  title:'Hourly temperature threshold',
  rules_primary:'Will the index be above 80 degrees Fahrenheit for Oct 14, 2026 at 10 AM EDT?',
  rules_secondary:'Synoptic Data measured under Kalshi Weather Index Methodology',
  strike_type:'greater',floor_strike:80,
  yes_bid_dollars:'0.40',yes_ask_dollars:'0.44',
  ...overrides,
});
function mock({miami=[market()],chicago=[],nyc=[],['la-coastal']:coastal=[],badSeries={},failedCity=null}={}){
 const quotes={miami,chicago,nyc,'la-coastal':coastal},calls=[];
 const client={
  async getSeries(ticker){
   calls.push(['series',ticker]);
   const city=Object.keys(INDEX_CITIES).find(c=>INDEX_CITIES[c].series===ticker);
   if(city===failedCity)throw new Error('market venue unavailable');
   return {...series(city),...(badSeries[city]??{})};
  },
  async getMarkets({series_ticker,status,min_close_ts,max_close_ts}){
   calls.push(['markets',series_ticker,{status,min_close_ts,max_close_ts}]);
   const city=Object.keys(INDEX_CITIES).find(c=>INDEX_CITIES[c].series===series_ticker);
   return quotes[city];
  },
 };
 return {client,calls};
}

test('source publisher sees a NEW contract from the public hourly venue census, not yesterday\'s full weather cycle',async()=>{
 const {client,calls}=mock();
 const r=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(r.contracts.length,1);
 assert.equal(r.coverage.length,4);
 assert.equal(r.errors.length,0);
 const c=r.contracts[0];
 assert.equal(c.binding.kind,'index-at');
 assert.equal(c.binding.city,'miami');
 assert.equal(c.binding.targetTime,'2026-10-14T14:00:00.000Z');
 assert.equal(c.family,'hourly-temperature');
 assert.equal(c.source,'synoptic');
 assert.ok(Math.abs(c.marketMid-0.42)<1e-12);
 assert.equal(c.marketObservedAt,'2026-10-14T13:00:00.000Z');
 assert.match(c.rulesHash,/^[a-f0-9]{64}$/u);
 assert.equal(calls.filter(c=>c[0]==='markets').length,4);
 assert.equal(calls.filter(c=>c[0]==='series').length,4);
 assert.equal(r.orderEffect,false);
});

test('changed hourly methodology or publisher never becomes an authorized index forecast',async()=>{
 const {client}=mock({badSeries:{miami:{contract_terms_url:'https://invalid.example/changed.pdf'}}});
 const changed=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(changed.contracts.length,0);
 assert.ok(changed.errors.some(e=>e.city==='miami'&&/methodology changed/.test(e.error)));

 const wrong=mock({miami:[market('miami',{rules_secondary:'National Weather Service station report instead of Synoptic methodology'})]});
 const result=await readHourlyIndexMarketCensus({client:wrong.client,now:at,clock});
 assert.equal(result.contracts.length,0);
 assert.ok(result.errors.some(e=>e.source==='Kalshi-hourly-contract'&&e.city==='miami'));
});

test('past-close, duplicate and nonbinary contracts cannot be projected as tradable',async()=>{
 const old=market('miami',{ticker:'OLD',close_time:'2026-10-14T12:59:59Z'});
 const invalid=market('miami',{ticker:'NOTBINARY',market_type:'combination'});
 const repeated=market('miami');
 const {client}=mock({miami:[old,invalid,repeated,repeated]});
 const census=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(census.contracts.length,1);
 assert.ok(census.errors.some(e=>/not a binary/.test(e.error)));
 assert.ok(census.errors.some(e=>/duplicate market/.test(e.error)));
});

test('market outage blocks that city only; another independently bound city is still visible',async()=>{
 const active=market('chicago',{
  ticker:'KXTEMPCHIHS-26OCT14-T80',
  series_ticker:INDEX_CITIES.chicago.series,
  event_ticker:'KXTEMPCHIHS-26OCT14',
  rules_primary:'Will Chicago be above 80 degrees Fahrenheit for Oct 14, 2026 at 9 AM CDT?',
 });
 const {client}=mock({failedCity:'miami',chicago:[active],miami:[]});
 const census=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(census.contracts.length,1);
 assert.equal(census.contracts[0].binding.city,'chicago');
 assert.equal(census.coverage.length,3);
 assert.ok(census.errors.some(e=>e.city==='miami'&&e.source==='Kalshi-hourly-census'));
});

test('wrong series in a fetched page never inherits the requested index rules',async()=>{
 const {client}=mock({miami:[market('miami',{series_ticker:'KXTEMPCHIHS'})]});
 const census=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(census.contracts.length,0);
 assert.ok(census.errors.some(e=>e.error==='wrong market series or not a binary contract'));
});

test('fast census uses compatible Kalshi close-time filters, not incompatible open-status query',async()=>{
 const {client,calls}=mock({miami:[market('miami',{status:'open'})]});
 const r=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.equal(r.contracts.length,1);
 for(const row of calls.filter(c=>c[0]==='markets')){
  assert.equal(row[2].status,undefined);
  assert.equal(row[2].min_close_ts,Math.floor(at/1000));
  assert.equal(row[2].max_close_ts,Math.ceil((at+6*3600000)/1000));
 }
});

test('paused, stale and distant markets do not consume the fast six-hour hour-turnover lane',async()=>{
 const {client}=mock({miami:[
  market('miami',{ticker:'PAUSED',status:'paused'}),
  market('miami',{ticker:'FAR',close_time:'2026-10-14T20:05:00Z'}),
  market('miami',{ticker:'READY',status:'open'}),
 ]});
 const r=await readHourlyIndexMarketCensus({client,now:at,clock});
 assert.deepEqual(r.contracts.map(c=>c.ticker),['READY']);
 await assert.rejects(readHourlyIndexMarketCensus({client,now:at,clock,horizonHours:25}),TypeError);
});
