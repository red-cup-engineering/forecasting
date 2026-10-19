/**
 * Aged derived weather records leave the host as one verified file a day (specification: the file section's
 * content-tree-archive.md, CA8 to CA10).
 *
 * A derived record is aged (weather-evidence-record.mjs ageDerived) once it passes the working window: a small record under
 * alias/<id>. Aged records still grow the store about 24 MB a day, so once one passes the archive window its day is archived:
 *   1. the day's aliases are exported, links followed, to <root>/archive/<day>.ctar (the file section's exportArchive: each
 *      node once, chunks the records share held once);
 *   2. the file is imported into an empty scratch store with the digest the export returned, and its tree must be complete
 *      (fsck) and every alias must name the address it names here: only then is anything of the live store changed;
 *   3. the day is entered in 'weather/archive-index' (day -> {file, sha256, bytes, nodes, ids}) and each alias is replaced by
 *      a stub that names where the record is. The next gc reclaims the records' nodes.
 * The host's offload-host-state moves <root>/archive/*.ctar to R2 (its copy verified by checksum before the local file is
 * deleted). A stub makes loadWeatherEvidence throw WEATHER_EVIDENCE_ARCHIVED with the day, the file, its digest and where it is;
 * restoreArchive brings the file back (offload-host-state --restore) and imports it with the digest the index holds, which names
 * the aliases again. Nothing here places, amends or cancels an order, or touches execution control.
 */
import {mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createContentTreeStore} from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import {evidenceStore,AGED_INDEX_REF,readAgedIndex,ARCHIVED_KIND} from './weather-evidence-record.mjs';
import {jsonDigest,readTree,saveTree} from './weather-state-tree.mjs';

export const ARCHIVE_INDEX_REF='weather/archive-index';
const DAY=86400000,DAY_TEXT=/^\d{4}-\d{2}-\d{2}$/u;
export const archiveFile=(root,day)=>join(root,'archive',`${day}.ctar`);
const dayOf=at=>new Date(Date.parse(at)).toISOString().slice(0,10);

/** The archive index: day -> {file, sha256, bytes, nodes, ids, archivedAt, restoredAt?}. */
export async function readArchiveIndex(root){return (await readTree(evidenceStore(root),ARCHIVE_INDEX_REF))?.value??{};}

/** Import `file` into an empty scratch store and check it holds exactly what `expected` (alias ref -> address) names. */
async function verifyArchive({root,day,file,sha256,expected,nodes}){
  const scratchRoot=join(root,'archive',`.verify-${day}-${process.pid}`);
  await rm(scratchRoot,{recursive:true,force:true});
  try{
    const scratch=createContentTreeStore({root:scratchRoot});
    await scratch.importArchive({file,sha256});
    const fsck=await scratch.fsck();
    if(fsck.damaged.length||fsck.missing.length||fsck.nodes!==nodes)throw new Error(`archive ${day} is not complete: ${fsck.nodes} of ${nodes} nodes, ${fsck.damaged.length} damaged, ${fsck.missing.length} missing`);
    for(const [ref,address] of Object.entries(expected)){
      if(await scratch.getRef(ref)!==address)throw new Error(`archive ${day} does not name ${ref} as the store does`);
      if(jsonDigest(await scratch.get(address))!==jsonDigest(await evidenceStore(root).get(address)))throw new Error(`archive ${day} does not reproduce ${ref} exactly`);
    }
  }finally{await rm(scratchRoot,{recursive:true,force:true});}
}

/**
 * Archive at most `days` whole days of aged records older than the archive window, oldest first. A day is archived only when
 * no derived record of that day or an earlier one is still to age. Failure to verify leaves the refs as they were and is
 * reported. Resolves {archived: ids moved, days: [{day, ids, bytes, sha256}], failed: [{day, error}]}.
 */
export async function archiveAged({root,now=Date.now(),archiveWindowDays,days=1}={}){
  if(!Number.isInteger(archiveWindowDays)||archiveWindowDays<1)throw new RangeError('an archive window is a whole number of days');
  await mkdir(join(root,'archive'),{recursive:true}); // the host's offload job names this directory from the first cycle on
  const store=evidenceStore(root),aged=await readAgedIndex(root);
  const unaged=(await readTree(store,'weather/derived-index'))?.value??{};
  const oldestUnaged=Object.values(unaged).map(dayOf).sort()[0]??'9999-12-31';
  const cutoffDay=dayOf(new Date(now-archiveWindowDays*DAY).toISOString());
  const index=await readArchiveIndex(root),byDay={};
  for(const [id,at] of Object.entries(aged))(byDay[dayOf(at)]??=[]).push(id);
  const due=Object.keys(byDay).filter(day=>day<cutoffDay&&day<oldestUnaged&&!index[day]).sort().slice(0,days);
  const result={archived:0,days:[],failed:[]};
  for(const day of due){
    try{
      const ids=byDay[day].sort(),expected={};
      for(const id of ids){const address=await store.getRef('alias/'+id);if(!address)throw new Error(`alias/${id} is not a ref`);expected['alias/'+id]=address;}
      const file=archiveFile(root,day),made=await store.exportArchive({refs:Object.keys(expected),file});
      await verifyArchive({root,day,file,sha256:made.sha256,expected,nodes:made.nodes});
      const entry={file:`archive/${day}.ctar`,sha256:made.sha256,bytes:made.bytes,nodes:made.nodes,ids:ids.length,archivedAt:new Date(now).toISOString()};
      await saveTree(store,ARCHIVE_INDEX_REF,{...index,[day]:entry});index[day]=entry;
      for(const id of ids){
        const stub=await store.put({kind:ARCHIVED_KIND,version:1,evidenceId:id,at:aged[id],day,archive:entry.file,sha256:entry.sha256,address:expected['alias/'+id]});
        await store.setRef('alias/'+id,stub);delete aged[id];
      }
      await saveTree(store,AGED_INDEX_REF,aged);
      result.archived+=ids.length;result.days.push({day,ids:ids.length,bytes:made.bytes,sha256:made.sha256});
    }catch(error){result.failed.push({day,error:error.message});}
  }
  return result;
}

/**
 * Bring a day's archive back: the file must be at <root>/archive/<day>.ctar (offload-host-state --restore puts it there from
 * R2); it is imported with the digest the archive index holds, which names alias/<id> for the day's records again. Resolves
 * {day, ids, written}. A file whose digest differs is refused and nothing is imported.
 */
export async function restoreArchive({root,day,now=Date.now()}={}){
  if(!DAY_TEXT.test(day??''))throw new TypeError('restore names a day, YYYY-MM-DD');
  const store=evidenceStore(root),index=await readArchiveIndex(root),entry=index[day];
  if(!entry)throw Object.assign(new Error(`no archive of ${day} is recorded`),{code:'WEATHER_ARCHIVE_UNKNOWN'});
  const file=archiveFile(root,day);
  try{await stat(file);}catch(error){
    if(error.code!=='ENOENT')throw error;
    throw Object.assign(new Error(`the archive of ${day} is not on this host (${entry.file}, sha256 ${entry.sha256}); restore it from R2 with offload-host-state.mjs --restore`),{code:'WEATHER_ARCHIVE_NOT_LOCAL',archive:entry.file,sha256:entry.sha256});
  }
  const done=await store.importArchive({file,sha256:entry.sha256});
  await saveTree(store,ARCHIVE_INDEX_REF,{...index,[day]:{...entry,restoredAt:new Date(now).toISOString()}});
  return {day,ids:done.refs.length,written:done.written};
}
