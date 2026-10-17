/**
 * Weather evidence records: each input is stored once, derivations are stored as what is new
 * plus names of what they were derived from.
 *
 * CONTRACT
 *
 * Ids. A record's evidenceId is the sha-256 (hex) of the exact JSON text of the record. Nothing
 * about this changed. The RFC 6920 form of the same digest is `ni:///sha-256;<base64url>`
 * (niOfHex / hexOfNi).
 *
 * Storage. Source, index-source and derived records are kept in the content tree store
 * (computer-file-engineering-services-section/content-tree-store) under `<root>/content-tree`,
 * as ref `evidence/<evidenceId>` -> tree root address, so the subtrees that successive records
 * share are stored once. get(root) is the record "exactly as JSON": sha-256 of JSON.stringify of
 * it is the evidenceId, and putEvidence / readEvidenceRecord verify that on every write and
 * read. Other records (participation, carry, research) and records written before the store
 * are `evidence/<evidenceId>.json.gz` files that gunzip to the JSON text; readers try the ref,
 * then the file, then the alias.
 *
 * Source record (unchanged; no `kind`, or a `kind` of its own such as
 *   kalshi-weather-index-source): the inputs of one collection: at, stations, guidance,
 *   hourlyGuidance, quantiles, lamp, settlement, local, observations, relational,
 *   ecmwfEnsemble, errors, indices. Stored once, before any derivation.
 *
 * Derived record (kind "kalshi-weather-derived", version 1): what one cycle derived from one
 *   source record and one station-science revision. It holds NO copy of the source and NO
 *   copy of the station-science state.
 *     kind, version
 *     at               the source's at
 *     inputs           ni name of the source record: hexOfNi(inputs) is its evidenceId
 *     scienceRevision  ni name of the station-science ledger revision this was derived from
 *                      (head after that cycle's update), or null if none is known
 *     dailyExtremes    new in this record: the hourly-to-daily extremes
 *     science          {at, scored, forecasted, status?,
 *                       parameters  the fitted postprocessing parameters a decision reads:
 *                                   keys "index:*" and "<station>/lamp-hourly-v2.7-v1/<horizon>",
 *                       forecasts   the index forecasts a decision reads: station "index:*",
 *                                   model ending "/paired-family-fixed-share-v2",
 *                       outcomes    {ni,count} naming this cycle's scored forecast/observation
 *                                   pairs in station-science/outcomes.jsonl.gz, or null}
 *     supersedes       (migrated records only) hex id of the full packet this one replaced
 *   Not stored, because it is recomputable from the above and the ledger:
 *     science.metrics, comparisons, pending, missingOutcomes, truth, scoring
 *         = stationScienceReport(state at scienceRevision)
 *     science.parameters (all keys) = fit(state at scienceRevision).history
 *     science.forecasts  (all stations) = stationPointForecasts(source, {now: state.at,
 *         parameters, learningState: state at scienceRevision})
 *
 * Loader. loadWeatherEvidence({root, evidenceId, detail}) returns the record every reader
 *   used to get from `evidence/<id>.json.gz`:
 *     {...source, dailyExtremes, science, sourceEvidenceId}
 *   - A record that is not derived (a legacy full packet, a source record, a participation
 *     record) is returned exactly as stored.
 *   - detail "used" (default): science = {at, scored?, forecasted?, status?, parameters,
 *     forecasts}, the fields readers use: weather-index priceWeatherIndex (science.at,
 *     parameters["index:*"], forecasts), weather-evidence lamp postprocessing
 *     (parameters["<station>/lamp-hourly-v2.7-v1/<horizon>"]), hourlyStationEvidence
 *     (at, parameters["index:*"], forecasts["index:*"]), allocateLiveWeather and the
 *     participation reader (local, indices, guidance, lamp), weatherEvidence (at,
 *     sourceEvidenceId, indices, dailyExtremes, and the input fields).
 *   - detail "full": science additionally carries truth, scoring, metrics, comparisons,
 *     pending, all parameters, missingOutcomes, every forecast and the outcomes, as before,
 *     re-derived from the ledger revision. If the revision is no longer retained,
 *     science.unavailable says so and the stored fields remain.
 *   - An id that no longer has a file but was superseded by migration is followed through
 *     evidence/aliases.jsonl ({from,to}); the target must name `from` in `supersedes`.
 *   - Every file read is verified: sha-256 of the gunzipped bytes equals the id.
 */
import {readFile,appendFile} from 'node:fs/promises';
import {createContentTreeStore} from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {niOfHex,hexOfNi,readOutcomes} from './weather-ledger.mjs';
import {scienceStateAt,stationScienceReport,stationPointForecasts} from './station-weather-science.mjs';

export const DERIVED_KIND='kalshi-weather-derived';
export const isUsedParameterKey=key=>key.startsWith('index:')||key.includes('/lamp-hourly-v2.7-v1/');
export const isUsedForecast=row=>row?.station?.startsWith('index:')&&row.model?.endsWith('/paired-family-fixed-share-v2');
const ID=/^[a-f0-9]{64}$/u;

/** The stored form of one cycle's derivation. `science` is the report updateStationScience returned. */
export function sealDerivedRecord({sourceEvidenceId,at,dailyExtremes,science,supersedes}){
  return {
    kind:DERIVED_KIND,version:1,at,
    inputs:niOfHex(sourceEvidenceId),
    scienceRevision:science?.revision??null,
    dailyExtremes,
    science:{
      at:science?.at??null,scored:science?.scored,forecasted:science?.forecasted,
      ...(science?.status?{status:science.status}:{}),
      parameters:Object.fromEntries(Object.entries(science?.parameters??{}).filter(([key])=>isUsedParameterKey(key))),
      forecasts:(science?.forecasts??[]).filter(isUsedForecast),
      outcomes:science?.outcomesRef??null,
    },
    ...(supersedes?{supersedes}:{}),
  };
}

const stores=new Map();
/** The root's content tree store, one instance per root so its node knowledge is shared. */
export function evidenceStore(root){
  if(!stores.has(root))stores.set(root,createContentTreeStore({root:join(root,'content-tree')}));
  return stores.get(root);
}
const jsonDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Store one record as a tree under its evidenceId; returns the id (sha-256 of its JSON). Idempotent. */
export async function putEvidence(root,record){
  const id=jsonDigest(record),store=evidenceStore(root),ref='evidence/'+id;
  if(await store.getRef(ref))return id;
  const address=await store.put(record);
  if(jsonDigest(await store.get(address))!==id)throw new Error('content tree did not reproduce the evidence record exactly');
  await store.setRef(ref,address);
  return id;
}
async function readStored(root,id){
  const store=evidenceStore(root),address=await store.getRef('evidence/'+id);
  if(!address)return null;
  const record=await store.get(address);
  if(jsonDigest(record)!==id)throw new TypeError('weather archive source hash mismatch');
  return {record,bytes:0};
}
async function readFileRecord(root,id){
  let bytes;
  try{bytes=await readFile(join(root,'evidence',`${id}.json.gz`));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  const decoded=gunzipSync(bytes);
  if(createHash('sha256').update(decoded).digest('hex')!==id)throw new TypeError('weather archive source hash mismatch');
  return {record:JSON.parse(decoded.toString('utf8')),bytes:bytes.length};
}
async function aliasOf(root,id){
  let text;
  try{text=await readFile(join(root,'evidence','aliases.jsonl'),'utf8');}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  let to=null;
  for(const line of text.split('\n'))if(line){const row=JSON.parse(line);if(row.from===id)to=row.to;}
  return to;
}
/** Record an alias; migration appends this only after the superseding record verified. */
export async function appendEvidenceAlias(root,{from,to}){
  if(!ID.test(from)||!ID.test(to))throw new TypeError('alias requires two evidence ids');
  await appendFile(join(root,'evidence','aliases.jsonl'),JSON.stringify({from,to})+'\n',{mode:0o600});
}

/** One verified read of a record by evidenceId: content tree ref, else archive file, else migration alias. */
export async function readEvidenceRecord({root,evidenceId}){
  if(!ID.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  let id=evidenceId,found=await readStored(root,id)??await readFileRecord(root,id);
  if(!found){
    const to=await aliasOf(root,evidenceId);
    if(!to)throw Object.assign(new Error(`weather evidence ${evidenceId} is not stored`),{code:'ENOENT'});
    id=to;found=await readStored(root,id)??await readFileRecord(root,id);
    if(!found)throw Object.assign(new Error(`weather evidence ${id} is not stored`),{code:'ENOENT'});
    if(found.record.supersedes!==evidenceId)throw new TypeError('weather evidence alias does not name its predecessor');
  }
  return {record:found.record,id,requested:evidenceId,bytes:found.bytes};
}

async function fullScience(root,record,source){
  const sciRoot=join(root,'station-science'),stored=record.science;
  const past=record.scienceRevision?await scienceStateAt(sciRoot,record.scienceRevision):null;
  const outcomes=stored.outcomes?await readOutcomes(sciRoot,stored.outcomes.ni):[];
  const science={at:stored.at};
  if(!past||outcomes===null){
    Object.assign(science,{scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),parameters:stored.parameters,forecasts:stored.forecasts,
      outcomes:outcomes??[],unavailable:!past?'station-science revision is not retained':'outcomes lineage is not retained'});
    return science;
  }
  const report=stationScienceReport(past.state);
  const forecasts=stored.status?stored.forecasts
    :stationPointForecasts({...source,dailyExtremes:record.dailyExtremes},{now:Date.parse(past.state.at),parameters:past.state.parameters,learningState:past.state});
  return {...report,scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),forecasts,outcomes};
}

export async function loadWeatherEvidence({root,evidenceId,detail='used'}={}){
  const {record}=await readEvidenceRecord({root,evidenceId});
  if(record?.kind!==DERIVED_KIND)return record;
  if(record.version!==1)throw new TypeError('unknown weather derived record version');
  const sourceId=hexOfNi(record.inputs),{record:source}=await readEvidenceRecord({root,evidenceId:sourceId});
  if(source?.kind===DERIVED_KIND)throw new TypeError('a derived weather record must name a source record');
  const science=detail==='full'?await fullScience(root,record,source):{
    at:record.science.at,
    ...(record.science.scored===undefined?{}:{scored:record.science.scored}),
    ...(record.science.forecasted===undefined?{}:{forecasted:record.science.forecasted}),
    ...(record.science.status?{status:record.science.status}:{}),
    parameters:record.science.parameters,forecasts:record.science.forecasts,
  };
  return {...source,dailyExtremes:record.dailyExtremes,science,sourceEvidenceId:sourceId};
}
