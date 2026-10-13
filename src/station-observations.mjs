/**
 * A station's temperature extremes so far in its climate day, from the NWS
 * observation API (api.weather.gov; public, asks only for a descriptive
 * User-Agent).
 *
 * The Daily Climate Report's day runs midnight to midnight local STANDARD
 * time, so under daylight time it starts at 01:00 on the clock. Hourly and
 * special METARs carry temperature in tenths of a degree C (the remark's
 * T-group) and synoptic METARs the exact six-hour maximum and minimum (the
 * 1sTTT and 2sTTT groups); the five-minute readings between them carry WHOLE
 * degrees C, so "22" is anywhere in 21.5-22.5 C (70.7-72.5 F). The report's
 * extreme comes from the station's continuous record in whole degrees F.
 *
 * Two bounds are returned. `floor`/`ceiling` are one degree looser than the
 * readings read as exact (the original rule). `floorPrecise`/`ceilingPrecise`
 * read each reading as the interval its precision allows: the day's maximum is
 * at least the highest LOWER end of any reading, so the report's whole-degree
 * high is at least that rounded; the minimum mirrors it.
 */
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {precipitationWitnesses} from './weather-precipitation.mjs';
import { readBody } from '@red-cup-engineering/http-services-section/body/web';
import { makeNiUri } from '@red-cup-engineering/uri-services-section/ni-uri';
import { admitCanonicalJson, JSON_RESOURCE_ENVELOPE } from '@red-cup-engineering/json-services-section/canonical-json';

export const NWS_API = 'https://api.weather.gov';
export const NWS_USER_AGENT = '(561 Group weather desk, ops@561.group)';

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

/** The date whose standard-time climate interval contains the observation instant. */
export function climateDate(timeZone, at = Date.now()) {
  const instant = new Date(at);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant).map(part => [part.type, part.value]));
  const civilDate = `${parts.year}-${parts.month}-${parts.day}`;
  // During daylight time, civil midnight begins the previous climate day's last hour.
  return instant.getTime() < climateDayStart(civilDate, timeZone).getTime()
    ? new Date(Date.parse(`${civilDate}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10)
    : civilDate;
}

/**
 * The whole-degree bounds the readings force on the report: its high is at least the round of the highest
 * lower end of any reading (each widened by its precision), its low at most the round of the lowest upper end.
 * Rounding half away matches a report that rounds its continuous extreme to whole degrees F.
 */
export function preciseBounds(readings,synoptic=[]){
  let lowEnd=-Infinity,highEnd=Infinity;
  for(const r of readings){if(r.qualityControl==='qc:X'||r.qualityControl==='qc:Q')continue;lowEnd=Math.max(lowEnd,r.temperatureF-r.precisionF);highEnd=Math.min(highEnd,r.temperatureF+r.precisionF);}
  for(const r of synoptic){if(r.kind==='max6h')lowEnd=Math.max(lowEnd,r.temperatureF-r.precisionF);else highEnd=Math.min(highEnd,r.temperatureF+r.precisionF);}
  return {floorPrecise:Number.isFinite(lowEnd)?Math.ceil(lowEnd-0.5):null,ceilingPrecise:Number.isFinite(highEnd)?Math.floor(highEnd+0.5):null};
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
  const empty = { station, date, from: from.toISOString(), count: 0, maxF: null, minF: null, floor: null, ceiling: null, floorPrecise: null, ceilingPrecise: null, latest: null, readings: [], synoptic: [], source: null };
  if (until <= from) return empty;
  const url = new URL(`${baseUrl}/stations/${station}/observations`);
  url.searchParams.set('start', from.toISOString());
  url.searchParams.set('end', until.toISOString());
  url.searchParams.set('limit','500');
  const readings=new Map(),visited=new Set(),synoptic=[],pages=[];let next=url.href;
  while(next){
    const pageUrl=new URL(next,url);if(pageUrl.origin!==url.origin||pageUrl.pathname!==url.pathname||visited.has(pageUrl.href)||visited.size>=8)throw new Error('station-observations: invalid or excessive observation pagination');
    visited.add(pageUrl.href);
    const signal=AbortSignal.timeout(30000);
    const res=await fetchImpl(pageUrl,{headers:{'user-agent':userAgent,accept:'application/geo+json'},signal});
    if(!res.ok)throw new Error(`station-observations: GET ${pageUrl} answered ${res.status}`);
    const rawBytes=await readBody({body:res.body,headers:res.headers,signal},{maxBytes:JSON_RESOURCE_ENVELOPE.maxSourceBytes,decodeContentEncoding:false});
    const page=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBytes)),receivedAt=new Date().toISOString();
    if(!page||!Array.isArray(page.features))throw new Error('station-observations: GeoJSON feature page required');
    pages.push({url:pageUrl.href,receivedAt,identity:makeNiUri(rawBytes),sha256:createHash('sha256').update(rawBytes).digest('hex'),bytes:rawBytes.byteLength,encoding:'gzip-base64',body:gzipSync(rawBytes).toString('base64'),packet:page});
    next=page.pagination?.next??null;
    for(const feature of page.features??[]) {
    const p=feature?.properties,temperature=p?.temperature,at=p?.timestamp,epoch=Date.parse(at);
    if(!Number.isFinite(epoch)||epoch<from.getTime()||epoch>until.getTime()||epoch>=from.getTime()+86400000||typeof temperature?.value!=='number'||!Number.isFinite(temperature.value))continue;
    const unit=temperature.unitCode??'wmoUnit:degC';
    if(!['wmoUnit:degC','wmoUnit:degF'].includes(unit))continue;
    const temperatureF=unit==='wmoUnit:degC'?temperature.value*9/5+32:temperature.value;
    if(temperatureF< -150||temperatureF>180)continue;
    const raw=typeof p.rawMessage==='string'?p.rawMessage:'';
    // Tenths when the METAR's T-group is present or the value is not whole; otherwise half a degree either way.
    const precisionF=/\sT[01]\d{3}[01]\d{3}(\s|$)/u.test(raw)||!Number.isInteger(temperature.value)?0.09:unit==='wmoUnit:degC'?0.9:0.5;
    const row={at:new Date(epoch).toISOString(),temperatureF,precisionF,qualityControl:temperature.qualityControl??null};
    const old=readings.get(row.at);if(!old||row.qualityControl==='qc:V'||old.precisionF>row.precisionF)readings.set(row.at,row);
    // Synoptic six-hour extremes (remarks 1sTTT max, 2sTTT min, tenths C) count when the six hours lie inside the day.
    const remarks=raw.split(' RMK ')[1]??'';
    if(epoch-6*3600000>=from.getTime())for(const token of remarks.split(/\s+/u)){
      const m=/^([12])([01])(\d{3})$/u.exec(token);if(!m)continue;
      const c=(m[2]==='1'?-1:1)*Number(m[3])/10,f=c*9/5+32,kind=m[1]==='1'?'max6h':'min6h';
      synoptic.push({at:row.at,kind,temperatureF:f,precisionF:0.09});
    }
  }
  }
  const receivedAt=new Date().toISOString(),precipitation=precipitationWitnesses(pages,{station,start:from.getTime(),end:from.getTime()+86400000,observedUntil:until.getTime(),receivedAt}),rawPages=pages.map(({packet,...raw})=>raw);
  const trace=[...readings.values()].sort((a,b)=>a.at.localeCompare(b.at));
  if(!trace.length)return {...empty,source:url.href,receivedAt,precipitation,rawPages};
  const temps=trace.map(r=>r.temperatureF),maxF=Math.max(...temps),minF=Math.min(...temps);
  const {floorPrecise,ceilingPrecise}=preciseBounds(trace,synoptic);
  return {station,date,from:from.toISOString(),count:trace.length,maxF,minF,floor:Math.floor(maxF)-1,ceiling:Math.ceil(minF)+1,floorPrecise,ceilingPrecise,latest:trace.at(-1).at,readings:trace,synoptic,source:url.href,receivedAt,precipitation,rawPages};
}

export const METAR_FEED = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations';

/**
 * A raw METAR's temperature at tenths of a degree C (the remark T-group, else the body's whole degrees) and its
 * synoptic six-hour extremes (remarks 1sTTT max, 2sTTT min). Pure.
 * @param {string} raw e.g. "KOKC 081452Z 00000KT 10SM CLR 24/13 A3010 RMK AO2 SLP179 T02390133 51015"
 * @param {Date|number} issued the bulletin's time, to date the day-and-hour group
 */
export function parseMetar(raw, issued) {
  if (typeof raw !== 'string') return null;
  const m = /^([A-Z0-9]{4})\s+(?:METAR\s+|SPECI\s+)?(\d{2})(\d{2})(\d{2})Z\b/u.exec(raw.trim());
  if (!m) return null;
  const ref = new Date(issued);
  if (!Number.isFinite(ref.getTime()) || +m[2] < 1 || +m[2] > 31 || +m[3] > 23 || +m[4] > 59) return null;
  let at = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Number(m[2]), Number(m[3]), Number(m[4]));
  if (at - ref.getTime() > 2 * 86400000) at = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, Number(m[2]), Number(m[3]), Number(m[4]));
  // Date.UTC normalizes impossible calendar days; that is not an observation.
  if (new Date(at).getUTCDate() !== +m[2]) return null;
  const c = (sign, digits) => (sign === '1' ? -1 : 1) * Number(digits) / 10, f = (x) => x * 9 / 5 + 32;
  const [body, remarks = ''] = raw.split(' RMK ');
  const tenths = /\sT([01])(\d{3})[01]\d{3}(\s|$)/u.exec(` ${remarks}`);
  const whole = /\s(M?\d{2})\/(M?\d{2})?(\s|$)/u.exec(` ${body}`);
  const temperatureF = tenths ? f(c(tenths[1], tenths[2])) : whole ? f(Number(whole[1].replace('M', '-'))) : null;
  const synoptic = [];
  for (const token of remarks.split(/\s+/u)) {
    const g = /^([12])([01])(\d{3})$/u.exec(token);
    if (g) synoptic.push({ at: new Date(at).toISOString(), kind: g[1] === '1' ? 'max6h' : 'min6h', temperatureF: f(c(g[2], g[3])), precisionF: 0.09 });
  }
  return { station: m[1], at: new Date(at).toISOString(), temperatureF, precisionF: tenths ? 0.09 : 0.9, synoptic, raw };
}

const METAR_BYTES = 4096;
const METAR_WIRE_ENVELOPE = Object.freeze({ ...JSON_RESOURCE_ENVELOPE, maxSourceBytes: 16384, maxCanonicalBytes: 16384 });

function metarStation(station) {
  if (typeof station !== 'string' || !/^[A-Z0-9]{4}$/u.test(station)) throw new TypeError('METAR station must be one uppercase four-character ICAO identifier');
  return station;
}

async function readMetarBulletin(station, { fetchImpl = fetch, feed = METAR_FEED, userAgent = NWS_USER_AGENT } = {}) {
  metarStation(station); // before constructing or acquiring any network resource
  const url = `${feed}/${station}.TXT`, signal = AbortSignal.timeout(10000);
  const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: 'text/plain' }, redirect: 'error', signal });
  if (!res.ok || res.redirected || res.url && res.url !== url) {
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new Error(`metar ${station}: ${res.status}`);
    throw new Error('METAR source must not redirect');
  }
  // A fetched Response is already decoded by fetch. Reuse the HTTP provider's
  // bounded stream reader and carry the same deadline through the body read.
  const bytes = await readBody({ body: res.body, headers: res.headers, signal }, { maxBytes: METAR_BYTES, decodeContentEncoding: false });
  // Preserve a UTF-8 BOM as content too, so re-encoding source.text recovers
  // every original byte covered by its NI identity.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const lines = text.trim().split(/\r?\n/u), [stamp, raw] = lines;
  if (!raw) return { report: null, bytes, text, url, issuedAt: null };
  if (lines.length !== 2 || !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/u.test(stamp)) throw new Error('METAR bulletin requires one UTC issue stamp and one report');
  const issuedAt = `${stamp.replace(/\//gu, '-').replace(' ', 'T')}:00.000Z`, issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || new Date(issued).toISOString() !== issuedAt) throw new Error('METAR bulletin issue stamp must be a real UTC calendar instant');
  const report = parseMetar(raw, issued);
  if (report && report.station !== station) throw new Error('METAR bulletin does not match its requested station');
  return { report, bytes, text, url, issuedAt };
}

/** The station's latest METAR from NWS's feed; retains the existing report-or-null API. */
export async function latestMetar({ station }, options = {}) {
  return (await readMetarBulletin(station, options)).report;
}

/** Fixed NWS US-station source; requests never choose another host or archive. */
export function admitNwsMetarSnapshot(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).length !== 1 || !Object.hasOwn(request, 'station')
    || typeof request.station !== 'string' || !/^K[A-Z0-9]{3}$/u.test(request.station)) {
    throw new TypeError('NWS METAR snapshot requires exactly one continental US ICAO station (Kxxx); foreign, archive and caller-selected sources are not admitted');
  }
  return Object.freeze({ station: request.station });
}

/**
 * One original public NWS bulletin and its existing parsed temperature view.
 * Original bytes are identified by the upstream NI provider; parsing and unit
 * conversion are attributed to the house, never represented as official NWS.
 */
export async function readNwsMetarSnapshot(request, { fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const { station } = admitNwsMetarSnapshot(request);
  const source = await readMetarBulletin(station, { fetchImpl });
  if (!source.report) throw new Error('NWS METAR snapshot has no admissible report');
  if (Date.parse(source.report.at) > Date.parse(source.issuedAt)) throw new Error('NWS METAR report is later than its bulletin issue stamp');
  const receivedAt = now();
  if (typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt)) || new Date(receivedAt).toISOString() !== receivedAt) throw new TypeError('METAR receipt time must be one canonical UTC ISO instant');
  const observedAgeSeconds = (Date.parse(receivedAt) - Date.parse(source.report.at)) / 1000;
  const bulletinAgeSeconds = (Date.parse(receivedAt) - Date.parse(source.issuedAt)) / 1000;
  if (observedAgeSeconds < 0 || bulletinAgeSeconds < 0) throw new Error('NWS METAR snapshot has future source timestamps');
  if (observedAgeSeconds > 7200 || bulletinAgeSeconds > 7200) throw new Error('NWS METAR snapshot exceeds the two-hour freshness bound');
  return admitCanonicalJson(JSON.stringify({
    observation: source.report,
    source: { url: source.url, identity: makeNiUri(source.bytes), bytes: source.bytes.byteLength, text: source.text,
      issuedAt: source.issuedAt, receivedAt,
      freshness: { observedAgeSeconds, bulletinAgeSeconds, maximumAgeSeconds: 7200 },
      attribution: 'NOAA National Weather Service',
      rights: { basis: 'public-domain US government information', authority: 'https://www.weather.gov/disclaimer/',
        commercialReuse: 'https://www.weather.gov/documentation/services-web-api',
        modifications: '561 Group parsed the temperature and converted units; source text is unchanged.',
        notice: '561 Group product; no NOAA or NWS endorsement. No copyright is claimed in the original NWS information.' } },
  }), METAR_WIRE_ENVELOPE).value;
}

/**
 * The day's extremes with a METAR folded in: its reading when it falls inside the climate day, and its six-hour
 * extremes when their six hours do. Returns the observations unchanged when the METAR adds nothing.
 */
export function withMetar(obs, metar) {
  if (!obs || !metar || !Number.isFinite(metar.temperatureF)) return obs;
  const from = Date.parse(obs.from), until = from + 86400000, at = Date.parse(metar.at);
  if (!(at >= from && at < until)) return obs;
  const known = obs.readings.find((r) => r.at === metar.at);
  const readings = known && known.precisionF <= metar.precisionF ? obs.readings
    : [...obs.readings.filter((r) => r.at !== metar.at), { at: metar.at, temperatureF: metar.temperatureF, precisionF: metar.precisionF, qualityControl: null, source: 'metar' }].sort((a, b) => a.at.localeCompare(b.at));
  const synoptic = [...(obs.synoptic ?? []), ...metar.synoptic.filter((g) => at - 6 * 3600000 >= from && !(obs.synoptic ?? []).some((o) => o.at === g.at && o.kind === g.kind))];
  const temps = readings.map((r) => r.temperatureF), maxF = Math.max(...temps), minF = Math.min(...temps);
  return { ...obs, count: readings.length, readings, synoptic, maxF, minF, floor: Math.floor(maxF) - 1, ceiling: Math.ceil(minF) + 1, ...preciseBounds(readings, synoptic), latest: readings.at(-1).at };
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

