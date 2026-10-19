/**
 * Weather evidence records: each input is stored once, derivations are stored as what is new
 * plus references to what they were derived from.
 *
 * CONTRACT
 *
 * Ids. A record's evidenceId is the sha-256 (hex) of the exact JSON text of the record. The
 * RFC 6920 form of the same digest is `ni:///sha-256;<base64url>` (niOfHex / hexOfNi).
 *
 * Storage. Every record is a tree in the weather root's content tree store
 * (computer-file-engineering-services-section/content-tree-store, at `<root>/content-tree`).
 * `get` returns the record exactly as JSON, so sha-256 of JSON.stringify of it is the evidenceId;
 * putEvidence and readEvidenceRecord verify that on every write and read. Successive records share
 * their repeated subtrees. Two kinds of reference, by what readers need for how long:
 *   - STRONG: ref `evidence/<evidenceId>` for a derived record, and a link {"/": address} inside a
 *     record. The store refuses to put a link to a tree it does not hold; gc keeps what refs and links
 *     reach and fsck follows them. A derived record strongly keeps the station-science state it was
 *     derived from, its outcomes and (migrated) its historical science, forever.
 *   - WEAK: a plain ni string (a tree's root address) that gc does not follow. A derived record's
 *     `inputs` is weak, and a raw source or index-source record is named only by ref
 *     `sources/<UTC date of its at>/<evidenceId>`. `expireSources` deletes the refs of days older than
 *     the retention window (default 14 days, `KALSHI_WEATHER_SOURCE_RETENTION_DAYS`, or the
 *     `sourceRetentionDays` option of runWeatherCycle); the next gc reclaims what only they reached. A
 *     derived record whose source has aged out still serves its stored science, parameters and states, but
 *     loadWeatherEvidence of its inputs fails with code WEATHER_SOURCE_AGED_OUT.
 *   Records written before the store are `evidence/<evidenceId>.json.gz` files; readers try the strong
 *   ref, the dated source refs, the file, then the alias. An alias is ref `alias/<old evidenceId>` naming
 *   the record that replaced it.
 *
 * Source record (no `kind`, or `kalshi-weather-index-source`): the inputs of one collection:
 *   at, stations, guidance, hourlyGuidance, quantiles, lamp, settlement, local, observations,
 *   relational, ecmwfEnsemble, errors, indices. Stored once, before any derivation.
 *
 * Derived record (kind "kalshi-weather-derived", version 3; version 2 read as before, with a strong
 *   `inputs` link and unhoisted forecasts): what one cycle derived from one source record and one
 *   station-science state. It holds NO copy of either.
 *     kind, version
 *     at               the source's at
 *     inputs           weak ni address of the source record's tree
 *     sourceEvidenceId hex evidenceId of that source (checked against the tree when loaded)
 *     scienceState     link to the station-science state tree this was derived from, or null
 *     dailyExtremes    new in this record: the hourly-to-daily extremes
 *     science          {at, scored, forecasted, status?,
 *                       parameters  the fitted postprocessing parameters a decision reads:
 *                                   keys "index:..." and ".../lamp-hourly-v2.7-v1/...",
 *                       forecasts   the index forecasts a decision reads: station "index:...",
 *                                   model ending "/paired-family-fixed-share-v2", run-hoisted
 *                                   (weather-run-hoist.mjs) against science.at when
 *                                   forecastsHoisted is true,
 *                       outcomes    link to the tree of this cycle's scored forecast/observation
 *                                   pairs, or null; outcomesCount}
 *     historicalScience (migrated records only) link to the tree of the whole `science` object the
 *                       legacy packet held, run-hoisted against science.at when historicalHoisted
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
import {walkPosixPaths} from '@red-cup-engineering/path-walking-service';
import {hoistRun,unhoistRun} from './weather-run-hoist.mjs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createContentTreeStore,contentTreeLink} from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import {scienceStateAt,stationScienceReport,stationPointForecasts} from './station-weather-science.mjs';
import {jsonDigest,readTree,saveTree} from './weather-state-tree.mjs';

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

export const DEFAULT_SOURCE_RETENTION_DAYS=14;
/** Days a raw source record is kept: KALSHI_WEATHER_SOURCE_RETENTION_DAYS, else 14. */
export function sourceRetentionDays(env=process.env){
  const raw=env.KALSHI_WEATHER_SOURCE_RETENTION_DAYS;
  if(raw===undefined||raw==='')return DEFAULT_SOURCE_RETENTION_DAYS;
  const days=Number(raw);
  if(!Number.isInteger(days)||days<1||days>3650)throw new RangeError('KALSHI_WEATHER_SOURCE_RETENTION_DAYS must be a whole number of days from 1 to 3650');
  return days;
}
const DAY=86400000;
const dateOf=ms=>new Date(ms).toISOString().slice(0,10);
const recordDate=at=>/^\d{4}-\d{2}-\d{2}/u.test(at??'')?at.slice(0,10):dateOf(Date.now());
export const sourceRefName=(date,id)=>`sources/${date}/${id}`;

/** Register a store for a root key (the migration's dry run uses a store that never touches the disk). */
export function useEvidenceStore(root,store){stores.set(root,store);}

/** The derived record one cycle stores. `science` is the report updateStationScience returned. */
export function sealDerivedRecord({sourceEvidenceId,sourceAddress,at,dailyExtremes,science,historicalScience,historicalHoisted=false,supersedes}){
  hexOfNi(sourceAddress);
  const used=(science?.forecasts??[]).filter(isUsedForecast);
  const run=science?.at?hoistRun(used,science.at):{value:used,hoisted:false};
  return {
    kind:DERIVED_KIND,version:3,at,
    inputs:sourceAddress,sourceEvidenceId,
    scienceState:science?.revision?contentTreeLink(science.revision):null,
    dailyExtremes,
    science:{
      at:science?.at??null,scored:science?.scored,forecasted:science?.forecasted,
      ...(science?.status?{status:science.status}:{}),
      parameters:Object.fromEntries(Object.entries(science?.parameters??{}).filter(([key])=>isUsedParameterKey(key))),
      forecasts:run.value,forecastsHoisted:run.hoisted,
      outcomes:science?.outcomesRef?contentTreeLink(science.outcomesRef.address):null,
      outcomesCount:science?.outcomesRef?.count??0,
    },
    ...(historicalScience?{historicalScience:contentTreeLink(historicalScience),historicalHoisted}:{}),
    ...(supersedes?{supersedes}:{}),
  };
}

/**
 * Store one record as a tree under its evidenceId. Resolves {id, address}; idempotent. A raw source
 * ({source:true}) is named only by its dated, weak-retention ref; every other record by evidence/<id>.
 */
export async function putEvidence(root,record,{source=false}={}){
  const id=jsonDigest(record),store=evidenceStore(root),ref=source?sourceRefName(recordDate(record.at),id):'evidence/'+id;
  const have=await store.getRef(ref);
  if(have)return {id,address:have,ref};
  const address=await store.put(record);
  if(jsonDigest(await store.get(address))!==id)throw new Error('content tree did not reproduce the evidence record exactly');
  await store.setRef(ref,address);
  return {id,address,ref};
}
/** Name `address` (a stored record) as the successor of the legacy id `from`. */
export async function putEvidenceAlias(root,{from,address}){
  if(!ID.test(from))throw new TypeError('alias requires an evidence id');
  await evidenceStore(root).setRef('alias/'+from,address);
}

/** Address of a raw source by its dated ref: the date it came with, else the retention window back from today. */
async function sourceAddress(root,id,dateHint){
  const store=evidenceStore(root);
  if(dateHint)return store.getRef(sourceRefName(dateHint,id));
  const days=sourceRetentionDays()+2,today=Date.now();
  for(let back=0;back<=days;back++){const address=await store.getRef(sourceRefName(dateOf(today-back*DAY),id));if(address)return address;}
  return null;
}
async function readStored(root,id,dateHint){
  const store=evidenceStore(root),address=await store.getRef('evidence/'+id)??await sourceAddress(root,id,dateHint);
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

/** One verified read of a record by evidenceId: strong ref, dated source ref, archive file, else alias. */
export async function readEvidenceRecord({root,evidenceId,dateHint}){
  if(!ID.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  const found=await readStored(root,evidenceId,dateHint)??await readFileRecord(root,evidenceId);
  if(found)return {...found,id:evidenceId,requested:evidenceId};
  const store=evidenceStore(root),address=await store.getRef('alias/'+evidenceId);
  if(!address)throw Object.assign(new Error(`weather evidence ${evidenceId} is not stored`),{code:'ENOENT'});
  const record=await store.get(address);
  if(record?.supersedes!==evidenceId)throw new TypeError('weather evidence alias does not name its predecessor');
  return {record,address,id:jsonDigest(record),requested:evidenceId};
}

async function listFiles(dir){
  try{return (await walkPosixPaths({root:dir,digest:false})).files;}
  catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return [];throw e;}
}
/**
 * Delete the dated source refs of ONE day older than the retention window (the oldest first), so a
 * cycle's expiry work is one day's refs. Resolves {date, removed}; date is null when nothing is due.
 * Their trees are reclaimed by the next gc; derived records keep what they link.
 */
export async function expireSources({root,now=Date.now(),retentionDays=sourceRetentionDays(),lookbackDays=60}={}){
  const store=evidenceStore(root),cutoff=now-retentionDays*DAY;
  for(let back=lookbackDays;back>=1;back--){
    const date=dateOf(cutoff-back*DAY),files=await listFiles(join(root,'content-tree','refs','sources',date));
    if(!files.length)continue;
    for(const file of files)await store.deleteRef(sourceRefName(date,file.path));
    return {date,removed:files.length};
  }
  return {date:null,removed:0};
}

/**
 * The derived records a store holds by id, with the time of each: a small tree ('weather/derived-index', id -> at), kept by the
 * cycle that makes the record, so ageing never reads a record to learn its age. A store without one builds it once from its records.
 */
export const DERIVED_INDEX_REF='weather/derived-index';
export async function indexDerived(root,{id,at}){
  const store=evidenceStore(root),held=await readTree(store,DERIVED_INDEX_REF);
  await saveTree(store,DERIVED_INDEX_REF,{...(held?.value??await buildDerivedIndex(root)),[id]:at});
}
async function buildDerivedIndex(root){
  const store=evidenceStore(root),index={};
  for await(const name of store.refs('evidence/')){
    const record=await store.get(await store.getRef(name));
    if(record?.kind===DERIVED_KIND&&record.version===3&&record.scienceState)index[name.slice('evidence/'.length)]=record.at;
  }
  return index;
}
/**
 * A derived record in its aged form: the same record, its link to the station-science state it was derived from now a bare
 * address (a weak reference, as `inputs` is), so the state revision it alone kept can be reclaimed. What readers use of it (detail
 * 'used') does not need the revision; detail 'full' of an aged record says WEATHER_STATE_AGED_OUT once the revision is gone.
 */
export function ageDerivedRecord(record,id){
  if(record?.kind!==DERIVED_KIND||record.version!==3||!record.scienceState)throw new TypeError('only a v3 derived record with its state link ages');
  const {scienceState,...rest}=record;
  return {...rest,scienceState:null,scienceStateAddress:scienceState['/'],scienceStateAged:true,supersedes:id};
}
/**
 * Age the derived records older than the working window, oldest first, at most `limit` (a cycle's share): each is stored in its
 * aged form under alias/<id> and its strong ref evidence/<id> removed, so the old id still resolves. Resolves {aged}.
 */
export async function ageDerived({root,now=Date.now(),workingWindowDays,limit=200}={}){
  const store=evidenceStore(root),held=await readTree(store,DERIVED_INDEX_REF),index={...(held?.value??await buildDerivedIndex(root))},cutoff=now-workingWindowDays*DAY;
  const due=Object.entries(index).filter(([,at])=>Date.parse(at)<cutoff).sort((a,b)=>a[1].localeCompare(b[1])).slice(0,limit);
  let aged=0;
  for(const [id] of due){
    const address=await store.getRef('evidence/'+id);
    if(!address){delete index[id];continue;}
    const record=await store.get(address);
    if(record?.kind!==DERIVED_KIND||record.version!==3||!record.scienceState){delete index[id];continue;}
    const slim=ageDerivedRecord(record,id),slimAddress=await store.put(slim);
    if(jsonDigest(await store.get(slimAddress))!==jsonDigest(slim))throw new Error('content tree did not reproduce the aged record exactly');
    await store.setRef('alias/'+id,slimAddress);await store.deleteRef('evidence/'+id);
    delete index[id];aged++;
  }
  if(due.length||!held)await saveTree(store,DERIVED_INDEX_REF,index);
  return {aged};
}

async function fullScience(root,record,source){
  const store=evidenceStore(root),stored=record.science,stamp=stored.at;
  if(record.scienceStateAged&&!await store.has(record.scienceStateAddress))throw Object.assign(new Error('the station-science state this weather record was derived from has aged out (its working window passed)'),{code:'WEATHER_STATE_AGED_OUT'});
  const forecasts=record.version>=3&&stored.forecastsHoisted?unhoistRun(stored.forecasts,stamp):stored.forecasts;
  if(record.historicalScience){
    const tree=await store.get(record.historicalScience['/']);
    return record.historicalHoisted?unhoistRun(tree,stamp):tree;
  }
  const past=record.scienceState?await scienceStateAt(store,record.scienceState['/']):record.scienceStateAged?await scienceStateAt(store,record.scienceStateAddress):null;
  const outcomes=stored.outcomes?await store.get(stored.outcomes['/']):[];
  if(!past)return {at:stored.at,scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),parameters:stored.parameters,forecasts,outcomes};
  const report=stationScienceReport(past.state);
  const all=stored.status?forecasts
    :stationPointForecasts({...source,dailyExtremes:record.dailyExtremes},{now:Date.parse(past.state.at),parameters:past.state.parameters,learningState:past.state});
  return {...report,scored:stored.scored,forecasted:stored.forecasted,...(stored.status?{status:stored.status}:{}),forecasts:all,outcomes};
}

export async function loadWeatherEvidence({root,evidenceId,detail='used',dateHint}={}){
  const {record}=await readEvidenceRecord({root,evidenceId,dateHint});
  if(record?.kind!==DERIVED_KIND)return record;
  if(record.version!==2&&record.version!==3)throw new TypeError('unknown weather derived record version');
  const store=evidenceStore(root),address=typeof record.inputs==='string'?record.inputs:record.inputs['/'];
  if(!await store.has(address))throw Object.assign(new Error(`the source ${record.sourceEvidenceId} of weather evidence ${evidenceId} has aged out`),{code:'WEATHER_SOURCE_AGED_OUT'});
  const source=await store.get(address);
  if(jsonDigest(source)!==record.sourceEvidenceId)throw new TypeError('derived weather record does not name the source it references');
  const hoisted=record.version>=3&&record.science.forecastsHoisted;
  const science=detail==='full'?await fullScience(root,record,source):{
    at:record.science.at,
    ...(record.science.scored===undefined?{}:{scored:record.science.scored}),
    ...(record.science.forecasted===undefined?{}:{forecasted:record.science.forecasted}),
    ...(record.science.status?{status:record.science.status}:{}),
    parameters:record.science.parameters,forecasts:hoisted?unhoistRun(record.science.forecasts,record.science.at):record.science.forecasts,
  };
  return {...source,dailyExtremes:record.dailyExtremes,science,sourceEvidenceId:record.sourceEvidenceId};
}
