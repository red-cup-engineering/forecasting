import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,copyFile,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {indexDerived,ageDerived,readEvidenceRecord,loadWeatherEvidence,evidenceStore,readAgedIndex,DERIVED_KIND,ARCHIVED_KIND,niOfHex} from '../src/weather-evidence-record.mjs';
import {archiveAged,restoreArchive,readArchiveIndex,archiveFile} from '../src/weather-archive.mjs';
import {upkeep,readRetentionPolicy} from '../src/weather-retention.mjs';
import {jsonDigest} from '../src/weather-state-tree.mjs';

const DAY=86400000,NOW=Date.parse('2026-10-30T12:00:00Z');
const scratch=async t=>{const dir=await mkdtemp(join(tmpdir(),'weather-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'weather');};
const hex=text=>createHash('sha256').update(text).digest('hex');

/** `count` derived v3 records of a day, each with its own state revision and a chunk of science every record of the day shares. */
async function seed(root,day,count){
  const store=evidenceStore(root),ids=[];
  const shared=await store.put({parameters:Array.from({length:200},(_,i)=>({name:`p${i}`,value:i,day}))});
  for(let i=0;i<count;i++){
    const at=`${day}T${String(10+i).padStart(2,'0')}:00:00.000Z`,id=hex(`${day}/${i}`);
    const revision=await store.put({state:{at,rows:Array.from({length:20},(_,j)=>({j,i,day,x:j*i}))}});
    const record={kind:DERIVED_KIND,version:3,at,sourceEvidenceId:hex('src'+id),inputs:niOfHex(hex('inputs'+id)),dailyExtremes:{forecasts:[],gaps:[]},scienceState:{'/':revision},science:{at,parameters:{'/':shared},forecasts:[]}};
    await store.setRef('evidence/'+id,await store.put(record));
    await indexDerived(root,{id,at});ids.push(id);
  }
  return ids;
}

test('archiving: an aged day leaves as one verified file, its aliases name where it is, and a restore brings it back',async t=>{
  const root=await scratch(t),store=evidenceStore(root);
  const old=await seed(root,'2026-10-01',2),next=await seed(root,'2026-10-02',1),recent=await seed(root,'2026-10-28',1);
  assert.equal((await ageDerived({root,now:NOW,workingWindowDays:7})).aged,3);
  assert.deepEqual(Object.keys(await readAgedIndex(root)).sort(),[...old,...next].sort());
  const slim=await Promise.all(old.map(async id=>(await readEvidenceRecord({root,evidenceId:id})).record));

  // inside the archive window nothing leaves
  assert.equal((await archiveAged({root,now:NOW,archiveWindowDays:60})).archived,0);
  // past it, one day a cycle, oldest first
  const first=await archiveAged({root,now:NOW,archiveWindowDays:14,days:1});
  assert.deepEqual([first.archived,first.days.map(d=>d.day),first.failed],[2,['2026-10-01'],[]]);
  const entry=(await readArchiveIndex(root))['2026-10-01'];
  assert.equal(entry.file,'archive/2026-10-01.ctar');
  assert.equal(entry.sha256,createHash('sha256').update(await readFile(archiveFile(root,'2026-10-01'))).digest('hex'),'the index holds the digest of the bytes');

  // the alias names the archive, not a missing node, and the other days are as they were
  for(const id of old)await assert.rejects(()=>loadWeatherEvidence({root,evidenceId:id}),error=>error.code==='WEATHER_EVIDENCE_ARCHIVED'&&error.archive===entry.file&&error.sha256===entry.sha256&&error.day==='2026-10-01');
  const stub=await store.get(await store.getRef('alias/'+old[0]));
  assert.equal(stub.kind,ARCHIVED_KIND);
  assert.ok((await readEvidenceRecord({root,evidenceId:next[0]})).record.scienceStateAged,'an unarchived aged record still reads');
  assert.equal((await archiveAged({root,now:NOW,archiveWindowDays:14,days:1})).days[0].day,'2026-10-02');
  assert.equal((await archiveAged({root,now:NOW,archiveWindowDays:14,days:1})).archived,0,'nothing left that is old enough');
  assert.ok(await store.getRef('evidence/'+recent[0]),'a record inside the working window is untouched');

  // gc reclaims the records the archive now holds
  const slimAddress=stub.address;
  assert.ok(await store.has(slimAddress));
  await store.gc({graceMs:0,major:true});
  assert.equal(await store.has(slimAddress),false);
  assert.deepEqual((({damaged,missing})=>[damaged,missing])(await store.fsck()),[[],[]]);

  // restore: the file must be here; a damaged one is refused and changes nothing; the right one names the aliases again
  const file=archiveFile(root,'2026-10-01'),saved=join(root,'..','saved.ctar');
  await copyFile(file,saved);await rm(file);
  await assert.rejects(()=>restoreArchive({root,day:'2026-10-01'}),{code:'WEATHER_ARCHIVE_NOT_LOCAL'});
  const bytes=await readFile(saved);bytes[Math.floor(bytes.length/2)]^=0xff;await writeFile(file,bytes);
  await assert.rejects(()=>restoreArchive({root,day:'2026-10-01'}));
  assert.equal((await store.get(await store.getRef('alias/'+old[0]))).kind,ARCHIVED_KIND,'a refused restore leaves the stub');
  await copyFile(saved,file);
  const restored=await restoreArchive({root,day:'2026-10-01',now:NOW});
  assert.equal(restored.ids,2);
  for(const [i,id] of old.entries()){
    const {record}=await readEvidenceRecord({root,evidenceId:id});
    assert.equal(jsonDigest(record),jsonDigest(slim[i]),'the record comes back exactly');
  }
  assert.ok((await readArchiveIndex(root))['2026-10-01'].restoredAt);
  await assert.rejects(()=>restoreArchive({root,day:'2026-09-30'}),{code:'WEATHER_ARCHIVE_UNKNOWN'});
  assert.deepEqual((({damaged,missing})=>[damaged,missing])(await store.fsck()),[[],[]]);
  assert.equal((await archiveAged({root,now:NOW,archiveWindowDays:14,days:5})).archived,0,'a restored day is not archived again');
});

test('archiving: a day waits while any record of it or an earlier day is still to age, and a day that fails to verify leaves its aliases',async t=>{
  const root=await scratch(t),store=evidenceStore(root);
  const old=await seed(root,'2026-10-01',2);
  await ageDerived({root,now:NOW,workingWindowDays:7});
  const late=await seed(root,'2026-09-30',1);
  assert.equal((await archiveAged({root,now:NOW,archiveWindowDays:14})).archived,0,'an earlier day not yet aged holds the later one');
  await ageDerived({root,now:NOW,workingWindowDays:7});
  await store.deleteRef('alias/'+old[1]);
  const lost=await archiveAged({root,now:NOW,archiveWindowDays:14,days:2});
  assert.deepEqual(lost.days.map(d=>d.day),['2026-09-30']);
  assert.equal(lost.failed.length,1);assert.match(lost.failed[0].error,/is not a ref/u);
  assert.equal((await store.get(await store.getRef('alias/'+old[0]))).scienceStateAged,true,'the failed day keeps its aliases');
  assert.equal(late.length,1);
  assert.deepEqual(Object.keys(await readArchiveIndex(root)),['2026-09-30']);
  await assert.rejects(()=>archiveAged({root,now:NOW,archiveWindowDays:0}),RangeError);
});

test('the policy declares the archive window and a cycle that archives reclaims',async()=>{
  const policy=readRetentionPolicy();
  assert.ok(policy.derivedArchiveWindowDays>=policy.derivedWorkingWindowDays);
  assert.ok(policy.archiveDaysPerCycle>=1);
  let gcs=0;
  const run=archived=>upkeep({policy,state:{at:new Date(NOW-3600000).toISOString(),bytesAfter:1000,growthBytesPerDay:1},now:NOW,bytesOf:async()=>1000,expire:async()=>({removed:0}),gc:async()=>{gcs++;return {};},archive:async()=>({archived})});
  assert.equal((await run(0)).gcRan,false);
  assert.equal((await run(3)).gcRan,true);assert.equal(gcs,1);
});
