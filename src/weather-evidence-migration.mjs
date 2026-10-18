/**
 * Migration of weather evidence archives to the tree forms of weather-evidence-record.mjs.
 *
 * CONTRACT
 *   For each `evidence/<id>.json.gz` in a weather state root, in name order, in batches:
 *     1. gunzip; its sha-256 must be <id>, else it is reported `corrupt` and left alone.
 *     2. A legacy derived packet (has science and sourceEvidenceId, no kind): its source is the
 *        packet without {dailyExtremes, science, sourceEvidenceId} and must hash to
 *        sourceEvidenceId. The source goes into the content tree store (ref evidence/<its id>);
 *        the packet's whole `science` object (metrics, comparisons, pending, every forecast,
 *        outcomes...) goes into the store as its own tree, so consecutive packets share their
 *        subtrees and nothing the packet held is dropped; the new derived record
 *        (sealDerivedRecord, supersedes: <id>) links both.
 *     3. A source or index-source packet (no science, kind absent or kalshi-weather-index-source)
 *        goes into the store.
 *     4. Any other kind (participation, carry, research) is left as a file.
 *     After a batch's refs are durable, each record is VERIFIED through the loader: detail "used"
 *     must reproduce every field readers use (all source fields, dailyExtremes, sourceEvidenceId,
 *     science.at/scored/forecasted/status, the index parameters and fixed-share index forecasts)
 *     and detail "full" must reproduce the legacy science object exactly. Only then is the file
 *     removed, and for a derived packet ref alias/<old id> is set to its successor.
 *   scores/<id>.json files whose exact text is already a line of resolved.jsonl are removed
 *   (resolved.jsonl is the record; the score file only made the append idempotent).
 *   Dry run (default) performs the same conversion and verification into a scratch directory
 *   and removes nothing; it reports the bytes the real run would free. Apply requires the
 *   weather cycle lock, so no cycle runs while evidence is moved. Pack merging is `gc`.
 */
import {readdir,rm,stat,mkdtemp} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFileBytes,readFileText} from '@red-cup-engineering/computer-file-engineering-services-section/read-file';
import {DERIVED_KIND,sealDerivedRecord,loadWeatherEvidence,isUsedParameterKey,isUsedForecast,evidenceStore,putEvidenceAlias} from './weather-evidence-record.mjs';
import {jsonDigest} from './weather-state-tree.mjs';

const ID=/^([a-f0-9]{64})\.json\.gz$/u;
const sha=text=>createHash('sha256').update(text).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const BATCH=8;

async function treeBytes(dir){
  let total=0,entries=[];
  try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  for(const entry of entries){const path=join(dir,entry.name);total+=entry.isDirectory()?await treeBytes(path):(await stat(path)).size;}
  return total;
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
  const work=apply?root:await mkdtemp(join(tmpdir(),'weather-migration-'));
  const store=evidenceStore(work);
  const baseline=await treeBytes(join(work,'content-tree'));
  const names=(await readdir(source)).filter(n=>ID.test(n)).sort();
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
    for(const item of batch)await store.setRef('evidence/'+item.staged.id,item.staged.address);
    if(batch.some(i=>i.sourceStaged))for(const item of batch)if(item.sourceStaged)await store.setRef('evidence/'+item.sourceStaged.id,item.sourceStaged.address);
    await store.flush();
    for(const item of batch){
      try{
        if(item.derived){
          const newId=item.staged.id;
          const loaded=await loadWeatherEvidence({root:work,evidenceId:newId});
          const bad=readerDifferences(item.record,loaded);
          const full=await loadWeatherEvidence({root:work,evidenceId:newId,detail:'full'});
          if(!same(full.science,item.record.science))bad.push('science(full)');
          if(bad.length)throw new Error('loader does not reproduce: '+bad.join(','));
          await putEvidenceAlias(work,{from:item.id,address:item.staged.address});if(apply)await rm(item.path);
          report.derivedMigrated++;
        }else{
          const loaded=await loadWeatherEvidence({root:work,evidenceId:item.id});
          if(!same(loaded,item.record))throw new Error('stored source does not reproduce the archive');
          if(apply)await rm(item.path);
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
        const historical=await store.put(science);
        if(jsonDigest(await store.get(historical))!==jsonDigest(science))throw new Error('content tree did not reproduce the legacy science exactly');
        const staged=await stage(sealDerivedRecord({sourceEvidenceId,sourceAddress:sourceStaged.address,at:record.at,dailyExtremes,science:{...science,revision:null,outcomesRef:null},historicalScience:historical,supersedes:id}));
        batch.push({id,path,bytes:bytes.length,record,derived:true,staged,sourceStaged});
      }else if(record&&record.science===undefined&&(record.kind===undefined||record.kind==='kalshi-weather-index-source')){
        batch.push({id,path,bytes:bytes.length,record,derived:false,staged:await stage(record)});
      }else{
        const kind=record?.kind??'unknown';report.left[kind]=(report.left[kind]??0)+1;
      }
    }catch(error){report.failed.push({id,error:error.message});}
    if(batch.length>=BATCH)await finish();
  }
  await finish();
  report.bytesAfter=(await treeBytes(join(work,'content-tree')))-baseline;
  report.evidenceBytesFreed=report.bytesMigrated-report.bytesAfter;
  report.scores=await migrateScores({root,apply});
  report.legacy={};
  for(const file of ['station-science/state.json','pending.json','grades.json','latest.json']){try{report.legacy[file]=(await stat(join(root,file))).size;}catch(e){if(e.code!=='ENOENT')throw e;}}
  report.legacyNote='these become trees on the next cycle (verified, then removed); their bytes are not counted above';
  report.totalBytesFreed=report.evidenceBytesFreed+report.scores.bytes;
  report.migrated=report.derivedMigrated+report.sourcesMigrated;
  if(!apply)await rm(work,{recursive:true,force:true});
  return report;
}

/** Score files that are already, byte for byte, a line of resolved.jsonl. */
async function migrateScores({root,apply}){
  const dir=join(root,'scores');
  let names=[];try{names=await readdir(dir);}catch(e){if(e.code==='ENOENT')return {files:0,bytes:0};throw e;}
  const lines=new Set();
  try{for await(const line of createInterface({input:createReadStream(join(root,'resolved.jsonl')),crlfDelay:Infinity}))if(line)lines.add(sha(line));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  let files=0,bytes=0;
  for(const name of names){
    const path=join(dir,name),text=(await readFileText(path)).replace(/\n$/u,'');
    if(!lines.has(sha(text)))continue;
    files++;bytes+=Buffer.byteLength(text)+1;
    if(apply)await rm(path);
  }
  return {files,bytes};
}
