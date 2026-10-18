/**
 * Weather evidence records: each input is stored once, derivations are stored as what is new
 * plus links to what they were derived from.
 *
 * CONTRACT
 *
 * Ids. A record's evidenceId is the sha-256 (hex) of the exact JSON text of the record. The
 * RFC 6920 form of the same digest is `ni:///sha-256;<base64url>` (niOfHex / hexOfNi).
 *
 * Storage. Every record is a tree in the weather root's content tree store
 * (computer-file-engineering-services-section/content-tree-store, at `<root>/content-tree`),
 * named by ref `evidence/<evidenceId>`. `get` returns the record exactly as JSON, so
 * sha-256 of JSON.stringify of it is the evidenceId; putEvidence and readEvidenceRecord verify
 * that on every write and read. Successive records share their repeated subtrees. A link
 * {"/": address} inside a record names another tree in the same store; the store refuses to
 * put a link to a tree it does not hold, gc keeps what links reach and fsck follows them, so
 * retention is reachability from refs. Records written before the store are
 * `evidence/<evidenceId>.json.gz` files; readers try the ref, then the file, then the alias.
 * An alias is ref `alias/<old evidenceId>` naming the record that replaced it.
 *
 * Source record (no `kind`, or `kalshi-weather-index-source`): the inputs of one collection:
 *   at, stations, guidance, hourlyGuidance, quantiles, lamp, settlement, local, observations,
 *   relational, ecmwfEnsemble, errors, indices. Stored once, before any derivation.
 *
 * Derived record (kind "kalshi-weather-derived", version 2): what one cycle derived from one
 *   source record and one station-science state. It holds NO copy of either.
 *     kind, version
 *     at               the source's at
 *     inputs           link to the source record's tree
 *     sourceEvidenceId hex evidenceId of that source (checked against the tree when loaded)
 *     scienceState     link to the station-science state tree this was derived from, or null
 *     dailyExtremes    new in this record: the hourly-to-daily extremes
 *     science          {at, scored, forecasted, status?,
 *                       parameters  the fitted postprocessing parameters a decision reads:
 *                                   keys "index:..." and ".../lamp-hourly-v2.7-v1/...",
 *                       forecasts   the index forecasts a decision reads: station "index:...",
 *                                   model ending "/paired-family-fixed-share-v2",
 *                       outcomes    link to the tree of this cycle's scored forecast/observation
 *                                   pairs, or null; outcomesCount}
 *     historicalScience (migrated records only) link to the tree of the whole `science` object
 *                       the legacy packet held; consecutive packets share most of its subtrees
 *     supersedes       (migrated records only) hex id of the full packet this one replaced
 *   Recomputable, so not stored in a new record: science.metrics, comparisons, pending,
 *   missingOutcomes, truth, scoring = stationScienceReport(scienceState); all parameters =
 *   fit(scienceState.history); every forecast = stationPointForecasts(source, {now:
 *   scienceState.at, parameters, learningState: scienceState}).
 *
 * Loader. loadWeatherEvidence({root, evidenceId, detail}) returns the record every reader
 *   used to get: {...source, dailyExtremes, science, sourceEvidenceId}.
 *   - A record that is not derived (legacy full packet, source, participation) comes back as stored.
 *   - detail "used" (default): science = {at, scored?, forecasted?, status?, parameters,
 *     forecasts}: weather-index priceWeatherIndex (science.at, parameters["index:..."],
 *     forecasts), weather-evidence lamp postprocessing (parameters of the lamp model),
 *     hourlyStationEvidence (at, index parameters and index forecasts), allocateLiveWeather and
 *     the participation reader (local, indices, guidance, lamp), weatherEvidence (at,
 *     sourceEvidenceId, indices, dailyExtremes and the input fields).
 *   - detail "full": science additionally carries truth, scoring, metrics, comparisons,
 *     pending, all parameters, missingOutcomes, every forecast and the outcomes, as before,
 *     re-derived from scienceState; for a migrated record it is the historicalScience tree.
 */
import {readFileBytes} from '@red-cup-engineering/computer-file-engineering-services-section/read-file';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createContentTreeStore,contentTreeLink} from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import {scienceStateAt,stationScienceReport,stationPointForecasts} from './station-weather-science.mjs';
import {jsonDigest} from './weather-state-tree.mjs';

export const DERIVED_KIND='kalshi-weather-derived';
export const isUsedParameterKey=key=>key.startsWith('index:')||key.includes('/lamp-hourly-v2.7-v1/');
export const isUsedForecast=row=>row?.station?.startsWith('index:')&&row.model?.endsWith('/paired-family-fixed-share-v2');
const ID=/^[a-f0-9]{64}$/u;
const NI_PREFIX='ni:///sha-256;';

export const niOfHex=hex=>{
  if(!ID.test(hex??''))throw new TypeError('a sha-256 hex digest is required');
  return NI_PREFIX+Buffer.from(hex,'hex').toString('base64url');
};
export const hexOfNi=ni=>{
  const m=/^ni:\/\/\/sha-256;([A-Za-z0-9_-]{43})$/u.exec(ni??'');
  const bytes=m&&Buffer.from(m[1],'base64url');
  if(!bytes||bytes.length!==32||bytes.toString('base64url')!==m[1])throw new TypeError('a canonical sha-256 ni URI is required');
  return bytes.toString('hex');
};

const stores=new Map();
/** The root's content tree store, one instance per root so its node knowledge is shared. */
export function evidenceStore(root){
  if(!stores.has(root))stores.set(root,createContentTreeStore({root:join(root,'content-tree')}));
  return stores.get(root);
}

/** The derived record one cycle stores. `science` is the report updateStationScience returned. */
export function sealDerivedRecord({sourceEvidenceId,sourceAddress,at,dailyExtremes,science,historicalScience,supersedes}){
  return {
    kind:DERIVED_KIND,version:2,at,
    inputs:contentTreeLink(sourceAddress),sourceEvidenceId,
    scienceState:science?.revision?contentTreeLink(science.revision):null,
    dailyExtremes,
    science:{
      at:science?.at??null,scored:science?.scored,forecasted:science?.forecasted,
      ...(science?.status?{status:science.status}:{}),
      parameters:Object.fromEntries(Object.entries(science?.parameters??{}).filter(([key])=>isUsedParameterKey(key))),
      forecasts:(science?.forecasts??[]).filter(isUsedForecast),
      outcomes:science?.outcomesRef?contentTreeLink(science.outcomesRef.address):null,
      outcomesCount:science?.outcomesRef?.count??0,
    },
    ...(historicalScience?{historicalScience:contentTreeLink(historicalScience)}:{}),
    ...(supersedes?{supersedes}:{}),
  };
}

/** Store one record as a tree under its evidenceId. Resolves {id, address}; idempotent. */
export async function putEvidence(root,record){
  const id=jsonDigest(record),store=evidenceStore(root),ref='evidence/'+id;
  const have=await store.getRef(ref);
  if(have)return {id,address:have};
  const address=await store.put(record);
  if(jsonDigest(await store.get(address))!==id)throw new Error('content tree did not reproduce the evidence record exactly');
  await store.setRef(ref,address);
  return {id,address};
}
/** Name `address` (a stored record) as the successor of the legacy id `from`. */
export async function putEvidenceAlias(root,{from,address}){
  if(!ID.test(from))throw new TypeError('alias requires an evidence id');
  await evidenceStore(root).setRef('alias/'+from,address);
}

async function readStored(root,id){
  const store=evidenceStore(root),address=await store.getRef('evidence/'+id);
  if(!address)return null;
  const record=await store.get(address);
  if(jsonDigest(record)!==id)throw new TypeError('weather archive source hash mismatch');
  return {record,address};
}
async function readFileRecord(root,id){
  let bytes;
  try{bytes=await readFileBytes(join(root,'evidence',`${id}.json.gz`));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  const decoded=gunzipSync(bytes);
  if(createHash('sha256').update(decoded).digest('hex')!==id)throw new TypeError('weather archive source hash mismatch');
  return {record:JSON.parse(decoded.toString('utf8')),address:null};
}

/** One verified read of a record by evidenceId: tree ref, else archive file, else alias. */
export async function readEvidenceRecord({root,evidenceId}){
  if(!ID.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  const found=await readStored(root,evidenceId)??await readFileRecord(root,evidenceId);
  if(found)return {...found,id:evidenceId,requested:evidenceId};
  const store=evidenceStore(root),address=await store.getRef('alias/'+evidenceId);
  if(!address)throw Object.assign(new Error(`weather evidence ${evidenceId} is not stored`),{code:'ENOENT'});
  const record=await store.get(address);
  if(record?.supersedes!==evidenceId)throw new TypeError('weather evidence alias does not name its predecessor');
  return {record,address,id:jsonDigest(record),requested:evidenceId};
}

async function fullScience(root,record,source){
  const store=evidenceStore(root),stored=record.science;
  if(record.historicalScience)return store.get(record.historicalScience['/']);
  const past=record.scienceState?await scienceStateAt(store,record.scienceState['/']):null;
  const outcomes=stored.outcomes?await store.get(stored.outcomes['/']):[];
  if(!past)return {at:stored.at,scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),parameters:stored.parameters,forecasts:stored.forecasts,outcomes};
  const report=stationScienceReport(past.state);
  const forecasts=stored.status?stored.forecasts
    :stationPointForecasts({...source,dailyExtremes:record.dailyExtremes},{now:Date.parse(past.state.at),parameters:past.state.parameters,learningState:past.state});
  return {...report,scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),forecasts,outcomes};
}

export async function loadWeatherEvidence({root,evidenceId,detail='used'}={}){
  const {record}=await readEvidenceRecord({root,evidenceId});
  if(record?.kind!==DERIVED_KIND)return record;
  if(record.version!==2)throw new TypeError('unknown weather derived record version');
  const source=await evidenceStore(root).get(record.inputs['/']);
  if(jsonDigest(source)!==record.sourceEvidenceId)throw new TypeError('derived weather record does not name the source it links');
  const science=detail==='full'?await fullScience(root,record,source):{
    at:record.science.at,
    ...(record.science.scored===undefined?{}:{scored:record.science.scored}),
    ...(record.science.forecasted===undefined?{}:{forecasted:record.science.forecasted}),
    ...(record.science.status?{status:record.science.status}:{}),
    parameters:record.science.parameters,forecasts:record.science.forecasts,
  };
  return {...source,dailyExtremes:record.dailyExtremes,science,sourceEvidenceId:record.sourceEvidenceId};
}
