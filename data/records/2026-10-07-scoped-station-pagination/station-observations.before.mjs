/**
 * A station's temperature extremes so far in its climate day, from the NWS
 * observation API (api.weather.gov; public, asks only for a descriptive
 * User-Agent).
 *
 * The Daily Climate Report's day runs midnight to midnight local STANDARD
 * time, so under daylight time it starts at 01:00 on the clock. Hourly and
 * special observations carry temperature in tenths of a degree C; the
 * report's extreme comes from the station's continuous record in whole
 * degrees F, so it can only be at or beyond what the observations show. The
 * bounds returned are one degree looser than the observations, to cover
 * conversion and rounding: the day's maximum is at least `floor`, its
 * minimum at most `ceiling`.
 */
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {precipitationWitnesses} from './weather-precipitation.mjs';
export const NWS_API = 'https://api.weather.gov';
export const NWS_USER_AGENT = '(561 Group weather desk, ops@561.group)';

export const NWS_REPORT_CELL_VERSION='nws-metar-temperature-cell-v1';
export const NWS_REPORT_CELL_TRUTH='first received validated NWS METAR temperature cell; nearest identified report within 15 minutes';
/** Reporting quantization only: neither instrument error nor a final climate
 * extreme is identified. API numeric formatting/cadence supplies no precision. */
export function temperatureReportCells(pages,{station,start,end,receivedAt}){
 if(!Array.isArray(pages)||pages.length>8||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(Date.parse(receivedAt)))throw new TypeError('bounded observation pages, interval and receipt required');
 const witnesses=[],groups=new Map();let outsideWindowRows=0;
 for(const page of pages)for(const feature of page.packet.features??[]){
  const p=feature?.properties??{},q=p.temperature,epoch=Date.parse(p.timestamp),receipt=Date.parse(page.receivedAt),raw=typeof p.rawMessage==='string'?p.rawMessage.trim():'',featureStation=typeof p.station==='string'?p.station.split('/').at(-1):null;
  if(Number.isFinite(epoch)&&(epoch<start||epoch>=end)){outsideWindowRows++;continue;}
  const w={featureId:feature.id??p['@id']??null,pageSha256:page.sha256,source:page.url,availableAt:page.receivedAt,station,at:Number.isFinite(epoch)?new Date(epoch).toISOString():null,rawTemperature:q??null,rawMessage:raw,status:'precision-unidentified',cell:null};
  witnesses.push(w);
  if(!Number.isFinite(epoch)||epoch<start||epoch>=end){w.status='invalid-observation-time';continue;}
  if(!Number.isFinite(receipt)||receipt>Date.parse(receivedAt)||epoch>receipt){w.status='noncausal-report';continue;}
  if(featureStation&&featureStation!==station){w.status='station-mismatch';continue;}
  if(!['V','qc:V'].includes(q?.qualityControl)||!Number.isFinite(q?.value)||!['wmoUnit:degC','wmoUnit:degF'].includes(q?.unitCode)){w.status='missing-or-untrusted';continue;}
  if(!raw)continue;
  const header=/^(?:(?:METAR|SPECI)\s+)?([A-Z0-9]{4})\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(raw),at=new Date(epoch);
  if(!header||header[1]!==station||Number(header[2])!==at.getUTCDate()||Number(header[3])!==at.getUTCHours()||Number(header[4])!==at.getUTCMinutes()||at.getUTCSeconds()!==0){w.status='report-header-mismatch';continue;}
  const [body,remarks='']=raw.split(/\bRMK\b/,2),whole=/\b(M?\d{2})\/(?:M?\d{2}|\/\/)?(?=\s|$)/.exec(body),tenths=[...remarks.matchAll(/(?:^|\s)T([01])(\d{3})(?:[01]\d{3}|\/\/\/\/)(?=\s|$)/g)];
  const encoded=[];if(whole){const value=Number(whole[1].replace('M',''))*(whole[1].startsWith('M')?-1:1);encoded.push({kind:'whole-Celsius-body',valueC:value,resolutionC:1,lowC:value-.5,highC:value+.5});}
  for(const match of tenths){const value=Number(match[2])/10*(match[1]==='1'?-1:1);encoded.push({kind:'tenths-Celsius-remark',valueC:value,resolutionC:.1,lowC:value-.05,highC:value+.05});}
  if(!encoded.length)continue;
  const lowC=Math.max(...encoded.map(c=>c.lowC)),highC=Math.min(...encoded.map(c=>c.highC)),apiC=q.unitCode==='wmoUnit:degF'?(q.value-32)*5/9:q.value,apiEnvelope=whole?encoded[0]:{lowC,highC};
  const incompatible=lowC>highC||lowC*9/5+32< -150||highC*9/5+32>180||(apiEnvelope&&(apiC<apiEnvelope.lowC-1e-8||apiC>apiEnvelope.highC+1e-8));
  w.encodings=encoded;w.decodedApiF=q.unitCode==='wmoUnit:degF'?q.value:q.value*9/5+32;
  if(incompatible){w.status='contradictory-encoding';}
  else{w.status='identified';w.cell={lowF:lowC*9/5+32,highF:highC*9/5+32,resolutionBasis:encoded.some(c=>c.resolutionC===.1)?'tenths-Celsius-remark':'whole-Celsius-body'};}
  const group=groups.get(w.at)??[];group.push(w);groups.set(w.at,group);
 }
 const readings=[];
 for(const [at,rows] of groups){
  const cells=rows.filter(w=>w.cell),lowF=cells.length?Math.max(...cells.map(w=>w.cell.lowF)):null,highF=cells.length?Math.min(...cells.map(w=>w.cell.highF)):null,conflicted=rows.some(w=>w.status==='contradictory-encoding')||lowF===null||lowF>highF;
  readings.push({at,status:conflicted?'conflicted':'identified',lowF:conflicted?null:lowF,highF:conflicted?null:highF,temperatureF:conflicted?null:(lowF+highF)/2,availableAt:rows.reduce((a,w)=>a<w.availableAt?w.availableAt:a,''),source:rows[0].source,measurementOperator:NWS_REPORT_CELL_VERSION,witnesses:rows});
 }
 readings.sort((a,b)=>a.at.localeCompare(b.at));
 return {operator:NWS_REPORT_CELL_VERSION,truth:NWS_REPORT_CELL_TRUTH,receivedAt,outsideWindowRows,witnesses,readings,identified:readings.filter(r=>r.status==='identified').length,conflicted:readings.filter(r=>r.status==='conflicted').length,unidentified:witnesses.filter(w=>w.status==='precision-unidentified').length,scope:'closed inverse-rounding envelopes conditional on validated raw METAR encoding; no cadence-derived precision, instrument-error bound, independent-trial count or settlement certification'};
}

/** The UTC instant of local standard-time midnight starting `date` in `timeZone`. */
export function climateDayStart(date, timeZone) {
  const noon = new Date(`${date}T12:00:00Z`);
  // The zone's standard offset is the larger of its January and July offsets west of UTC.
  const offsetMinutes = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instant).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return (asUtc - instant.getTime()) / 60_000;
  };
  const year = noon.getUTCFullYear();
  const standard = Math.min(offsetMinutes(new Date(Date.UTC(year, 0, 15))), offsetMinutes(new Date(Date.UTC(year, 6, 15))));
  return new Date(Date.parse(`${date}T00:00:00Z`) - standard * 60_000);
}

/**
 * The extremes observed at `station` from the start of its climate day on
 * `date` until now.
 * @param {{station: string, date: string, timeZone: string, now?: Date|string|number}} request
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string, userAgent?: string}} [options]
 * @returns {Promise<{station: string, date: string, from: string, count: number, maxF: number|null, minF: number|null, floor: number|null, ceiling: number|null, latest: string|null}>}
 */
export async function observedExtremes({ station, date, timeZone, now = Date.now() }, { fetchImpl = fetch, baseUrl = NWS_API, userAgent = NWS_USER_AGENT } = {}) {
  const from = climateDayStart(date, timeZone);
  const until = new Date(Math.min(new Date(now).getTime(), from.getTime() + 24 * 3600_000));
  const empty = { station, date, from: from.toISOString(), count: 0, maxF: null, minF: null, floor: null, ceiling: null, latest: null, readings: [], source: null };
  if (until <= from) return empty;
  const url = new URL(`${baseUrl}/stations/${station}/observations`);
  url.searchParams.set('start', from.toISOString());
  url.searchParams.set('end', until.toISOString());
  url.searchParams.set('limit','500');
  const readings=new Map(),visited=new Set(),pages=[];let next=url.href;
  while(next){
    const pageUrl=new URL(next,url);if(pageUrl.origin!==url.origin||pageUrl.pathname!==url.pathname||visited.has(pageUrl.href)||visited.size>=8)throw new Error('station-observations: invalid or excessive observation pagination');
    visited.add(pageUrl.href);
    const res=await fetchImpl(pageUrl,{headers:{'user-agent':userAgent,accept:'application/geo+json'},signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw new Error(`station-observations: GET ${pageUrl} answered ${res.status}`);
    const rawText=typeof res.text==='function'?await res.text():JSON.stringify(await res.json()),rawBytes=Buffer.from(rawText),page=JSON.parse(rawText),receivedAt=new Date().toISOString();
    pages.push({url:pageUrl.href,receivedAt,sha256:createHash('sha256').update(rawBytes).digest('hex'),bytes:rawBytes.length,encoding:'gzip-base64',body:gzipSync(rawBytes).toString('base64'),serializationBasis:typeof res.text==='function'?'received response body':'reconstructed supplied-client JSON',packet:page});next=page.pagination?.next??null;
    for(const feature of page.features??[]) {
    const p=feature?.properties,temperature=p?.temperature,at=p?.timestamp,epoch=Date.parse(at);
    if(!Number.isFinite(epoch)||epoch<from.getTime()||epoch>until.getTime()||epoch>=from.getTime()+86400000||typeof temperature?.value!=='number'||!Number.isFinite(temperature.value))continue;
    const unit=temperature.unitCode??'wmoUnit:degC';
    if(!['wmoUnit:degC','wmoUnit:degF'].includes(unit))continue;
    const temperatureF=unit==='wmoUnit:degC'?temperature.value*9/5+32:temperature.value;
    if(temperatureF< -150||temperatureF>180)continue;
    const row={at:new Date(epoch).toISOString(),temperatureF,qualityControl:temperature.qualityControl??null};
    const old=readings.get(row.at);if(!old||row.qualityControl==='qc:V')readings.set(row.at,row);
  }
  }
  const receivedAt=new Date().toISOString(),precipitation=precipitationWitnesses(pages,{station,start:from.getTime(),end:from.getTime()+86400000,receivedAt}),rawPages=pages.map(({packet,...raw})=>raw);
  const temperatureMetrology=temperatureReportCells(pages,{station,start:from.getTime(),end:from.getTime()+86400000,receivedAt});
  const trace=[...readings.values()].sort((a,b)=>a.at.localeCompare(b.at));
  if(!trace.length)return {...empty,source:url.href,precipitation,rawPages,temperatureMetrology};
  const temps=trace.map(r=>r.temperatureF),maxF=Math.max(...temps),minF=Math.min(...temps);
  return {station,date,from:from.toISOString(),count:trace.length,maxF,minF,floor:Math.floor(maxF)-1,ceiling:Math.ceil(minF)+1,latest:trace.at(-1).at,readings:trace,source:url.href,precipitation,rawPages,temperatureMetrology};
}

/**
 * NWS products that announce a temperature regime the station's guidance error model was not fitted on.
 * Under one, the far tail on its side is the regime's risk, not a mispriced premium (2026-10-04: KSAN and
 * KLAX reached 100F under an Extreme Heat Warning while the model put 101F+ near 0.2%).
 */
export const WARM_HAZARDS = Object.freeze(['Extreme Heat Warning', 'Extreme Heat Watch', 'Excessive Heat Warning', 'Excessive Heat Watch', 'Heat Advisory']);
export const COLD_HAZARDS = Object.freeze(['Extreme Cold Warning', 'Extreme Cold Watch', 'Cold Weather Advisory', 'Wind Chill Warning', 'Wind Chill Advisory', 'Hard Freeze Warning', 'Hard Freeze Watch', 'Freeze Warning', 'Freeze Watch', 'Frost Advisory']);

const stationPoints = new Map();

/**
 * The warm and cold temperature hazards NWS has active at `station`'s location now.
 * @returns {Promise<{station: string, warm: string[], cold: string[]}>}
 */
export async function activeTemperatureHazards({ station }, { fetchImpl = fetch, baseUrl = NWS_API, userAgent = NWS_USER_AGENT } = {}) {
  const get = async (url) => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`NWS ${url}: ${response.status}`);
    return response.json();
  };
  if (!stationPoints.has(station)) {
    const [lon, lat] = (await get(`${baseUrl}/stations/${station}`)).geometry.coordinates;
    stationPoints.set(station, `${lat.toFixed(4)},${lon.toFixed(4)}`);
  }
  const events = (await get(`${baseUrl}/alerts/active?point=${stationPoints.get(station)}`)).features.map((feature) => feature.properties.event);
  return { station, warm: events.filter((event) => WARM_HAZARDS.includes(event)), cold: events.filter((event) => COLD_HAZARDS.includes(event)) };
}
