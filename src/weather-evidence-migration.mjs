/**
 * Migration of weather evidence archives to the stored forms of weather-evidence-record.mjs.
 *
 * CONTRACT
 *   For each `evidence/<id>.json.gz` in a weather state root, in name order:
 *     1. gunzip; its sha-256 must be <id>, else it is reported `corrupt` and left alone.
 *     2. A legacy derived packet (has science and sourceEvidenceId, no kind): its source is
 *        the packet without {dailyExtremes, science, sourceEvidenceId} and must hash to
 *        sourceEvidenceId. The source goes into the content tree store; the scored outcomes go
 *        to station-science/outcomes.jsonl.gz (the only copy of that lineage); the new derived
 *        record (sealDerivedRecord, supersedes: <id>) goes into the store; then
 *        VERIFICATION: loadWeatherEvidence of the new id must reproduce every field readers use
 *        (all source fields, dailyExtremes, sourceEvidenceId, science.at/scored/forecasted/
 *        status, the index parameters and the paired-family-fixed-share index forecasts), and
 *        detail "full" must reproduce science.outcomes exactly. Metrics, comparisons, pending
 *        and the other forecasts of that old cycle are recomputable only from a ledger
 *        revision that does not exist for a migrated cycle, and are not kept.
 *     3. A source or index-source packet (no science, kind absent or kalshi-weather-index-source)
 *        goes into the store and is verified by reading it back through the loader.
 *     4. Any other kind (participation, carry, research) is left as a file.
 *     Only after a record verified is its file removed, and for a derived packet an alias
 *     old id -> new id is appended to evidence/aliases.jsonl so pointers to the old id resolve.
 *   scores/<id>.json files whose exact text is already a line of resolved.jsonl are removed
 *   (resolved.jsonl is the record; the score file only made the append idempotent).
 *   Dry run (default) performs the same conversion and verification into a scratch directory
 *   and removes nothing; it reports the bytes the real run would free. Apply requires the
 *   weather cycle lock, so no cycle runs while evidence is moved.
 */
import {readdir,readFile,rm,stat,mkdtemp,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DERIVED_KIND,sealDerivedRecord,putEvidence,appendEvidenceAlias,loadWeatherEvidence,isUsedParameterKey,isUsedForecast,evidenceStore} from './weather-evidence-record.mjs';
import {appendOutcomes,listOutcomes} from './weather-ledger.mjs';

const ID=/^([a-f0-9]{64})\.json\.gz$/u;
const sha=text=>createHash('sha256').update(text).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

async function treeBytes(dir){
  let total=0;
  let entries=[];
  try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  for(const entry of entries){
    const path=join(dir,entry.name);
    total+=entry.isDirectory()?await treeBytes(path):(await stat(path)).size;
  }
  return total;
}

/** What readers use, compared old against loaded; returns the names of fields that differ. */
function readerDifferences(old,loaded){
  const bad=[];
  const keep=['dailyExtremes','science','sourceEvidenceId'];
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
  if(!apply){await mkdir(join(work,'evidence'),{recursive:true});await mkdir(join(work,'station-science'),{recursive:true});}
  const sciDir=join(work,'station-science');
  const storeBytes=()=>treeBytes(join(work,'content-tree')),outcomeBytes=()=>treeBytes(sciDir);
  const baseline=(await storeBytes())+(await outcomeBytes());
  const names=(await readdir(source)).filter(n=>ID.test(n)).sort();
  const knownOutcomes=await listOutcomes(sciDir);
  const report={apply,files:names.length,bytesBefore:0,bytesMigrated:0,derivedMigrated:0,sourcesMigrated:0,left:{},corrupt:[],failed:[],outcomeRows:0};
  for(const name of names){
    const id=ID.exec(name)[1],path=join(source,name);
    let bytes,text,record;
    try{
      bytes=await readFile(path);report.bytesBefore+=bytes.length;
      text=gunzipSync(bytes);
      if(sha(text)!==id){report.corrupt.push(id);continue;}
      record=JSON.parse(text.toString('utf8'));
    }catch(error){report.corrupt.push(id);continue;}
    try{
      if(record&&record.science&&record.sourceEvidenceId&&record.kind===undefined){
        const {dailyExtremes,science,sourceEvidenceId,...input}=record;
        if(sha(JSON.stringify(input))!==sourceEvidenceId)throw new Error('derived packet does not contain its source exactly');
        await putEvidence(work,input);
        let outcomesRef=null;
        if(science.outcomes?.length){
          const ni=await appendOutcomesOnce(sciDir,science.outcomes,knownOutcomes);
          outcomesRef={ni,count:science.outcomes.length};report.outcomeRows+=science.outcomes.length;
        }
        const next=sealDerivedRecord({sourceEvidenceId,at:record.at,dailyExtremes,science:{...science,revision:null,outcomesRef},supersedes:id});
        const newId=await putEvidence(work,next);
        const loaded=await loadWeatherEvidence({root:work,evidenceId:newId});
        const bad=readerDifferences(record,loaded);
        const full=await loadWeatherEvidence({root:work,evidenceId:newId,detail:'full'});
        if(!same(full.science.outcomes,science.outcomes??[]))bad.push('science.outcomes');
        if(bad.length)throw new Error('loader does not reproduce: '+bad.join(','));
        if(apply){await appendEvidenceAlias(root,{from:id,to:newId});await rm(path);}
        report.derivedMigrated++;report.bytesMigrated+=bytes.length;
      }else if(record&&record.science===undefined&&(record.kind===undefined||record.kind==='kalshi-weather-index-source')){
        await putEvidence(work,record);
        const loaded=await loadWeatherEvidence({root:work,evidenceId:id});
        if(!same(loaded,record))throw new Error('stored source does not reproduce the archive');
        if(apply)await rm(path);
        report.sourcesMigrated++;report.bytesMigrated+=bytes.length;
      }else{
        const kind=record?.kind??'unknown';report.left[kind]=(report.left[kind]??0)+1;
      }
    }catch(error){report.failed.push({id,error:error.message});}
    if((report.derivedMigrated+report.sourcesMigrated)%100===0)log(`${report.derivedMigrated} derived, ${report.sourcesMigrated} sources`);
  }
  await evidenceStore(work).flush();
  // Merge the one-pack-per-record writes; a short grace spares trees a concurrent writer has put but not yet named.
  if(apply)await evidenceStore(work).gc({graceMs:10*60000});
  report.bytesAfter=(await storeBytes())+(await outcomeBytes())-baseline;
  const migrated=report.derivedMigrated+report.sourcesMigrated;
  report.evidenceBytesFreed=report.bytesMigrated-report.bytesAfter;
  report.scores=await migrateScores({root,apply});
  report.legacy={};
  for(const file of ['station-science/state.json','pending.json']){try{report.legacy[file]=(await stat(join(root,file))).size;}catch(e){if(e.code!=='ENOENT')throw e;}}
  report.legacyNote='state.json and pending.json become ledgers on the next cycle (verified, then removed); their bytes are not counted above';
  report.totalBytesFreed=report.evidenceBytesFreed+report.scores.bytes;
  report.migrated=migrated;
  if(!apply)await rm(work,{recursive:true,force:true});
  return report;
}

async function appendOutcomesOnce(dir,outcomes,known){
  const text=JSON.stringify(outcomes),ni='ni:///sha-256;'+createHash('sha256').update(text).digest('base64url');
  if(known.has(ni))return ni;
  await appendOutcomes(dir,outcomes);known.add(ni);return ni;
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
    const path=join(dir,name),text=(await readFile(path,'utf8')).replace(/\n$/u,'');
    if(!lines.has(sha(text)))continue;
    files++;bytes+=Buffer.byteLength(text)+1;
    if(apply)await rm(path);
  }
  return {files,bytes};
}
