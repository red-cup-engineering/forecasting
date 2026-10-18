/**
 * Migration of weather evidence archives to the tree forms of weather-evidence-record.mjs.
 *
 * CONTRACT
 *   For each `evidence/<id>.json.gz` in a weather state root, in name order, in batches:
 *     1. gunzip; its sha-256 must be <id>, else it is reported `corrupt` and left alone.
 *     2. A legacy derived packet (has science and sourceEvidenceId, no kind): its source is the
 *        packet without {dailyExtremes, science, sourceEvidenceId} and must hash to
 *        sourceEvidenceId. The source goes into the content tree store (ref sources/<date>/<its id>, weak);
 *        the packet's whole `science` object (metrics, comparisons, pending, every forecast,
 *        outcomes...) goes into the store as its own tree, so consecutive packets share their
 *        subtrees and nothing the packet held is dropped; the new derived record
 *        (sealDerivedRecord, supersedes: <id>) links the science strongly and the source weakly. The
 *        science is run-hoisted first (weather-run-hoist.mjs): what every row of a run shares is stored once.
 *     3. A source or index-source packet (no science, kind absent or kalshi-weather-index-source)
 *        goes into the store under its dated source ref.
 *     4. Any other kind (participation, carry, research) is left as a file.
 *     After a batch's refs are durable, each record is VERIFIED through the loader: detail "used"
 *     must reproduce every field readers use (all source fields, dailyExtremes, sourceEvidenceId,
 *     science.at/scored/forecasted/status, the index parameters and fixed-share index forecasts)
 *     and detail "full" must reproduce the legacy science object exactly. Only then is the file
 *     removed, and for a derived packet ref alias/<old id> is set to its successor.
 *   scores/<id>.json files whose exact text is already a line of resolved.jsonl are removed
 *   (resolved.jsonl is the record; the score file only made the append idempotent).
 *   Dry run (default) performs the same conversion and verification into a store that never
 *   touches the disk but packs its nodes exactly as the file backend does (BGZF packs, index lines,
 *   ref files), removes nothing, and reports the bytes the real run would free. Apply requires the
 *   weather cycle lock, so no cycle runs while evidence is moved. Pack merging is `gc`.
 *
 * REQUIREMENT (measured 2026-10-18, forecasting 0.6.9): this migration's `--apply` does not run on Cold Red Gate (1.6 GB RAM). Its
 * working set is per record, not per file count: a derived packet is up to 70 MB of JSON (60 MB of science), and converting one holds
 * the record, its hoisted copy, the stored tree, the loader's copy and the digests' strings at once. 14 files OOM at a 256 MB heap and
 * pass at 1 GB (resident 1.1-1.4 GB); the dry run's backend no longer grows with the evidence, but this per-record peak remains. The
 * hoist (weather-run-hoist.mjs), the digests (jsonDigest) and the verification must stream, with a declared memory bound that a test
 * holds (a derived packet of 70 MB converted inside a 256 MB heap). Until then `--apply` runs on a host with the RAM, against a copy
 * of the weather root, and the result is carried back by the owners of that store.
 */
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {gunzipSync,inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFileBytes,readFileText} from '@red-cup-engineering/computer-file-engineering-services-section/read-file';
import {removeFile} from '@red-cup-engineering/computer-file-engineering-services-section/remove-file';
import {statPath} from '@red-cup-engineering/computer-file-engineering-services-section/stat-path';
import {bgzfPack} from '@red-cup-engineering/computer-file-engineering-services-section/bgzf';
import {createContentTreeStore} from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import {walkPosixPaths} from '@red-cup-engineering/path-walking-service';
import {hoistRun,unhoistRun} from './weather-run-hoist.mjs';
import {DERIVED_KIND,sealDerivedRecord,useEvidenceStore,sourceRefName,loadWeatherEvidence,isUsedParameterKey,isUsedForecast,evidenceStore,putEvidenceAlias} from './weather-evidence-record.mjs';
import {jsonDigest} from './weather-state-tree.mjs';

const ID=/^([a-f0-9]{64})\.json\.gz$/u;
const sha=text=>createHash('sha256').update(text).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const BATCH=8;

async function listFiles(dir){
  try{return (await walkPosixPaths({root:dir,digest:false})).files;}
  catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return [];throw e;}
}
const treeBytes=async dir=>(await listFiles(dir)).reduce((n,f)=>n+f.bytes,0);

/**
 * A content tree backend that stays in memory and counts what the file backend would write: nodes packed by the same
 * BGZF packer into one pack per flush plus an index line per node, and a ref file (address and newline) per ref. Only what a
 * dry run needs of a backend.
 *
 * What is kept is what the real run would write: the PACKED nodes (compressed, the number the dry run reports) and where each
 * lies in its pack, not the nodes' bytes. A node is unpacked from its block when it is read (a few blocks are cached), so a dry
 * run's memory is the size of the result, not of the evidence it converts: the first version kept every node's bytes and held
 * 2.86 GB for 150 of 1,691 files.
 */
function measuringBackend(){
  const packs=[],index=new Map(),pending=new Map(),refs=new Map(),cache=new Map();
  let packed=0;
  const BLOCKS=48,HEADER=18,FOOTER=8;
  const block=(pack,offset)=>{
    const key=pack+':'+offset,held=cache.get(key);
    if(held){cache.delete(key);cache.set(key,held);return held;}
    const bytes=packs[pack],size=bytes.readUInt16LE(offset+16)+1,data=inflateRawSync(bytes.subarray(offset+HEADER,offset+size-FOOTER));
    cache.set(key,data);if(cache.size>BLOCKS)cache.delete(cache.keys().next().value);
    return data;
  };
  return {
    packedBytes:()=>packed+[...refs.values()].reduce((n,a)=>n+a.length+1,0),
    has:async hex=>index.has(hex)||pending.has(hex),
    read:async hex=>{
      if(pending.has(hex))return pending.get(hex);
      const place=index.get(hex);
      return place?Buffer.from(block(place.pack,place.offset).subarray(place.at,place.at+place.length)):undefined;
    },
    write:async(hex,bytes)=>{pending.set(hex,bytes);},
    async flush(){
      if(!pending.size)return;
      const entries=[...pending],{bytes,places}=bgzfPack(entries.map(([,b])=>b));
      packed+=bytes.length+entries.map(([hex],i)=>`${hex} ${places[i].offset} ${places[i].at} ${places[i].length}\n`).join('').length;
      packs.push(bytes);
      entries.forEach(([hex],i)=>{if(!index.has(hex))index.set(hex,{pack:packs.length-1,offset:places[i].offset,at:places[i].at,length:places[i].length});});
      pending.clear();
    },
    async *list(){yield* new Set([...index.keys(),...pending.keys()]);},
    async repack(){return {kept:index.size,removed:0};},
    async check(){return {nodes:index.size,damaged:[]};},
    readRef:async name=>refs.get(name),
    writeRef:async(name,address)=>{refs.set(name,address);},
    removeRef:async name=>{refs.delete(name);},
    async *refs(prefix=''){for(const name of refs.keys())if(name.startsWith(prefix))yield name;},
  };
}

/** What readers use, compared old against loaded; returns the names of fields that differ. */
function readerDifferences(old,loaded){
  const bad=[],keep=['dailyExtremes','science','sourceEvidenceId'];
  for(const key of Object.keys(old))if(!keep.includes(key)&&!same(old[key],loaded[key]))bad.push(key);
  for(const key of Object.keys(loaded))if(!keep.includes(key)&&!(key in old))bad.push(key);
  if(!same(old.dailyExtremes,loaded.dailyExtremes))bad.push('dailyExtremes');
  if(old.sourceEvidenceId!==loaded.sourceEvidenceId)bad.push('sourceEvidenceId');
  for(const key of ['at','scored','forecasted','status'])if(!same(old.science[key],loaded.science[key]))bad.push('science.'+key);
  const usedParameters=Object.fromEntries(Object.entries(old.science.parameters??{}).filter(([k])=>isUsedParameterKey(k)));
  if(!same(usedParameters,loaded.science.parameters))bad.push('science.parameters');
  if(!same((old.science.forecasts??[]).filter(isUsedForecast),loaded.science.forecasts))bad.push('science.forecasts');
  return bad;
}

export async function migrateWeatherEvidence({root,apply=false,log=()=>{}}={}){
  const source=join(root,'evidence');
  let work=root,measure=null;
  if(!apply){
    measure=measuringBackend();work=join(root,`.dry-run-${randomUUID()}`);
    useEvidenceStore(work,createContentTreeStore({backend:measure}));
  }
  const store=evidenceStore(work);
  const baseline=apply?await treeBytes(join(work,'content-tree')):0;
  const names=(await listFiles(source)).map(f=>f.path).filter(n=>ID.test(n)).sort();
  const report={apply,files:names.length,bytesBefore:0,bytesMigrated:0,derivedMigrated:0,sourcesMigrated:0,left:{},corrupt:[],failed:[]};
  /** put a record as a tree (not yet named); resolves {id,address}. */
  const stage=async record=>{
    const id=jsonDigest(record),address=await store.put(record);
    if(jsonDigest(await store.get(address))!==id)throw new Error('content tree did not reproduce a record exactly');
    return {id,address};
  };
  let batch=[];
  async function finish(){
    if(!batch.length)return;
    for(const item of batch)await store.setRef(item.derived?'evidence/'+item.staged.id:sourceRefName(item.date,item.staged.id),item.staged.address);
    for(const item of batch)if(item.sourceStaged)await store.setRef(sourceRefName(item.date,item.sourceStaged.id),item.sourceStaged.address);
    await store.flush();
    for(const item of batch){
      try{
        if(item.derived){
          const newId=item.staged.id;
          const loaded=await loadWeatherEvidence({root:work,evidenceId:newId});
          const bad=readerDifferences(item.record,loaded);
          const full=await loadWeatherEvidence({root:work,evidenceId:newId,detail:'full'});
          if(!same(full.science,item.record.science))bad.push('science(full)');
          if(!same(unhoistRun(hoistRun(item.record.science,item.record.science.at).value,item.record.science.at),item.record.science))bad.push('hoist');
          if(bad.length)throw new Error('loader does not reproduce: '+bad.join(','));
          await putEvidenceAlias(work,{from:item.id,address:item.staged.address});if(apply)await removeFile({path:item.path});
          report.derivedMigrated++;
        }else{
          const loaded=await loadWeatherEvidence({root:work,evidenceId:item.id,dateHint:item.date});
          if(!same(loaded,item.record))throw new Error('stored source does not reproduce the archive');
          if(apply)await removeFile({path:item.path});
          report.sourcesMigrated++;
        }
        report.bytesMigrated+=item.bytes;
      }catch(error){report.failed.push({id:item.id,error:error.message});}
    }
    log(`${report.derivedMigrated} derived, ${report.sourcesMigrated} sources`);
    batch=[];
  }
  for(const name of names){
    const id=ID.exec(name)[1],path=join(source,name);
    let bytes,record;
    try{
      bytes=await readFileBytes(path);report.bytesBefore+=bytes.length;
      const text=gunzipSync(bytes);
      if(sha(text)!==id){report.corrupt.push(id);continue;}
      record=JSON.parse(text.toString('utf8'));
    }catch{report.corrupt.push(id);continue;}
    try{
      if(record&&record.science&&record.sourceEvidenceId&&record.kind===undefined){
        const {dailyExtremes,science,sourceEvidenceId,...input}=record;
        if(sha(JSON.stringify(input))!==sourceEvidenceId)throw new Error('derived packet does not contain its source exactly');
        const sourceStaged=await stage(input);
        const run=science.at?hoistRun(science,science.at):{value:science,hoisted:false};
        const historical=await store.put(run.value);
        if(jsonDigest(await store.get(historical))!==jsonDigest(run.value))throw new Error('content tree did not reproduce the legacy science exactly');
        const staged=await stage(sealDerivedRecord({sourceEvidenceId,sourceAddress:sourceStaged.address,at:record.at,dailyExtremes,science:{...science,revision:null,outcomesRef:null},historicalScience:historical,historicalHoisted:run.hoisted,supersedes:id}));
        batch.push({id,path,bytes:bytes.length,record,derived:true,staged,sourceStaged,date:String(record.at).slice(0,10)});
      }else if(record&&record.science===undefined&&(record.kind===undefined||record.kind==='kalshi-weather-index-source')){
        batch.push({id,path,bytes:bytes.length,record,derived:false,staged:await stage(record),date:String(record.at).slice(0,10)});
      }else{
        const kind=record?.kind??'unknown';report.left[kind]=(report.left[kind]??0)+1;
      }
    }catch(error){report.failed.push({id,error:error.message});}
    if(batch.length>=BATCH)await finish();
  }
  await finish();
  report.bytesAfter=apply?(await treeBytes(join(work,'content-tree')))-baseline:measure.packedBytes();
  report.evidenceBytesFreed=report.bytesMigrated-report.bytesAfter;
  report.scores=await migrateScores({root,apply});
  report.legacy={};
  for(const file of ['station-science/state.json','pending.json','grades.json','latest.json']){const seen=await statPath({path:join(root,file)});if(seen.exists)report.legacy[file]=seen.size;}
  report.legacyNote='these become trees on the next cycle (verified, then removed); their bytes are not counted above';
  report.totalBytesFreed=report.evidenceBytesFreed+report.scores.bytes;
  report.migrated=report.derivedMigrated+report.sourcesMigrated;
  return report;
}

/** Score files that are already, byte for byte, a line of resolved.jsonl. */
async function migrateScores({root,apply}){
  const dir=join(root,'scores');
  const names=(await listFiles(dir)).map(f=>f.path);
  if(!names.length)return {files:0,bytes:0};
  const lines=new Set();
  try{for await(const line of createInterface({input:createReadStream(join(root,'resolved.jsonl')),crlfDelay:Infinity}))if(line)lines.add(sha(line));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  let files=0,bytes=0;
  for(const name of names){
    const path=join(dir,name),text=(await readFileText(path)).replace(/\n$/u,'');
    if(!lines.has(sha(text)))continue;
    files++;bytes+=Buffer.byteLength(text)+1;
    if(apply)await removeFile({path});
  }
  return {files,bytes};
}
