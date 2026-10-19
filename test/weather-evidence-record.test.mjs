import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {makeNiUri} from '@red-cup-engineering/uri-services-section/ni-uri';
import {openTree,readTree,saveTree,releaseTree,importLegacyFile,jsonDigest} from '../src/weather-state-tree.mjs';
import {updateStationScience,readStationScience,readStationSciencePage,readScienceState,scienceStateAt,stationScienceReport} from '../src/station-weather-science.mjs';
import {sealDerivedRecord,putEvidence,indexDerived,ageDerived,ageDerivedRecord,putEvidenceAlias,readEvidenceRecord,loadWeatherEvidence,evidenceStore,expireSources,sourceRetentionDays,sourceRefName,niOfHex,hexOfNi,DERIVED_KIND,isUsedForecast} from '../src/weather-evidence-record.mjs';
import {hoistRun,unhoistRun} from '../src/weather-run-hoist.mjs';
import {migrateWeatherEvidence} from '../src/weather-evidence-migration.mjs';
import {readRetentionPolicy,retentionWindow,upkeep} from '../src/weather-retention.mjs';
import policyFile from '../content/config/weather-retention.json' with {type:'json'};
import {weatherEvidence,weatherStatus,weatherStatusPage,readLatest,scoreWeather,weatherStationSkillPage,weatherStoreGc,maintainStore} from '@red-cup-engineering/forecasting/weather-engine';

const sha=text=>createHash('sha256').update(text).digest('hex');
const json=value=>JSON.parse(JSON.stringify(value));
const scratch=async t=>{const dir=await mkdtemp(join(tmpdir(),'weather-record-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};

const T0=Date.parse('2026-10-10T12:00:00Z'),HOUR=3600000;
/** A small but real source packet: one station with hourly NWS guidance, plus optional observations. */
const source=(now,{readings=[]}={})=>({
  at:new Date(now).toISOString(),
  stations:[{station:'KNYC',timeZone:'America/New_York'}],
  local:{KNYC:{updated:new Date(now-600000).toISOString(),hourlyUrl:'https://example.test/hourly',
    periods:Array.from({length:8},(_,i)=>({startTime:new Date(Math.ceil(now/HOUR)*HOUR+i*HOUR).toISOString(),temperatureUnit:'F',temperature:60+i}))}},
  observations:{'KNYC/test':{station:'KNYC',source:'https://example.test/obs',readings}},
  errors:[],indices:{},
});
const readingsFor=(from,to)=>{const out=[];for(let at=Math.ceil(from/HOUR)*HOUR;at<=to;at+=HOUR)out.push({at:new Date(at).toISOString(),temperatureF:61.5});return out;};

test('ni names: hex round trip and agreement with the house makeNiUri',()=>{
  const bytes=Buffer.from('weather');
  assert.equal(niOfHex(sha('weather')),makeNiUri(new Uint8Array(bytes)));
  assert.equal(hexOfNi(niOfHex(sha('weather'))),sha('weather'));
  assert.throws(()=>hexOfNi('ni:///sha-256;short'),TypeError);
  assert.throws(()=>niOfHex('xyz'),TypeError);
});

test('state trees: a saved value is the next open, a legacy file is imported verified and removed, a ref moves only with its tree',async t=>{
  const dir=await scratch(t),store=evidenceStore(dir);
  assert.equal(await openTree(store,'x/head'),null);
  const first=await saveTree(store,'x/head',{rows:{a:1,b:2}});
  const open=await openTree(store,'x/head');
  assert.deepEqual(open.value,{rows:{a:1,b:2}});assert.equal(open.address,first);
  open.value.rows.c=3;
  const second=await saveTree(store,'x/head',open.value);
  assert.notEqual(second,first);
  assert.equal(await store.getRef('x/head'),second);
  assert.deepEqual(await store.get(first),{rows:{a:1,b:2}},'the previous revision stays readable');
  releaseTree(store,'x/head',second,{rows:{a:1,b:2,c:3}});
  assert.deepEqual((await readTree(store,'x/head')).value,{rows:{a:1,b:2,c:3}});
  const legacy=join(dir,'old.json');
  await writeFile(legacy,JSON.stringify({k:[1,2,3]}));
  const address=await importLegacyFile({store,ref:'legacy/head',path:legacy});
  assert.deepEqual(await store.get(address),{k:[1,2,3]});
  await assert.rejects(()=>stat(legacy),{code:'ENOENT'});
  assert.equal(await importLegacyFile({store,ref:'legacy/head',path:legacy}),null);
});

const science=async(root,now,evidence,sourceEvidenceId)=>updateStationScience(evidence,{root,store:evidenceStore(join(root,'..')),now,sourceEvidenceId});

test('station science: scores, learns and keeps its state as a tree; the report reads back from the head',async t=>{
  const dir=await scratch(t),root=join(dir,'station-science'),store=evidenceStore(dir);
  const first=await science(root,T0,source(T0),'a'.repeat(64));
  assert.ok(first.forecasted>0&&first.scored===0);
  const second=await science(root,T0+3*HOUR,source(T0+3*HOUR,{readings:readingsFor(T0+HOUR,T0+3*HOUR)}),'b'.repeat(64));
  assert.ok(second.scored>0);
  assert.notEqual(second.revision,first.revision);
  assert.equal(await store.getRef('station-science/head'),second.revision);
  // Every revision stays readable by its address.
  assert.equal(Object.keys((await scienceStateAt(store,first.revision)).state.history).length,0);
  const {state,revision}=await readScienceState(store,root);
  assert.equal(revision,second.revision);
  const report=await readStationScience({root,store});
  assert.deepEqual(json(report),json(stationScienceReport(state)));
  assert.equal(report.pending,Object.keys(state.pending).length);
  assert.deepEqual(Object.keys(await store.get(revision)).sort(),['at','comparisons','history','missingOutcomes','pending'],'parameters are refit from history, never stored');
  // Pending rows are clustered by valid time.
  const validTimes=Object.values((await store.get(revision)).pending).map(r=>r.validTime);
  assert.deepEqual(validTimes,[...validTimes].sort());
  // Every scored forecast kept its forecast/observation pair, by link.
  assert.equal(second.outcomesRef.count,second.scored);
  assert.deepEqual(json(second.outcomes),await store.get(second.outcomesRef.address));
  // Paging is bound to the revision.
  const page=await readStationSciencePage({root,store,field:'metrics',limit:5});
  assert.equal(page.source.revision,second.revision);
  await science(root,T0+4*HOUR,source(T0+4*HOUR),'c'.repeat(64));
  await assert.rejects(()=>readStationSciencePage({root,store,field:'metrics',limit:5,sourceRevision:page.source.revision}),/revision changed/);
});

test('station science: a pre-tree state.json is imported, verified against its tree and removed',async t=>{
  const dir=await scratch(t),root=join(dir,'station-science'),store=evidenceStore(dir);
  await mkdir(root,{recursive:true});
  const legacy={pending:{p1:{station:'KNYC',model:'m',validTime:'2026-10-10T20:00:00.000Z',meanF:60,scaleF:2,horizon:'3-6h',date:'2026-10-10',availableAt:'2026-10-10T12:00:00.000Z',nu:5}},
    history:{},comparisons:{},missingOutcomes:3,parameters:{'KNYC/m/3-6h':{ready:true}},at:'2026-10-10T12:00:00.000Z'};
  await writeFile(join(root,'state.json'),JSON.stringify(legacy));
  assert.equal((await readStationScience({root,store})).pending,1,'readable before its first import');
  await science(root,T0+HOUR,source(T0+HOUR),'d'.repeat(64));
  await assert.rejects(()=>stat(join(root,'state.json')),{code:'ENOENT'});
  const state=await store.get(await store.getRef('station-science/head'));
  assert.equal(state.missingOutcomes,3);
  assert.ok(state.pending.p1);
  assert.equal(state.parameters,undefined);
});

test('derived record: ids are sha-256 of the record JSON, inputs are links, nothing is copied',async t=>{
  const dir=await scratch(t),root=join(dir,'weather'),sciRoot=join(root,'station-science');
  const src=source(T0);
  const {id:sourceId,address:sourceAddress}=await putEvidence(root,src,{source:true});
  assert.equal(sourceId,sha(JSON.stringify(src)));
  const result=await science(sciRoot,T0,{...src},sourceId);
  const dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70}],gaps:[]};
  const record=sealDerivedRecord({sourceEvidenceId:sourceId,sourceAddress,at:src.at,dailyExtremes,science:result});
  assert.equal(record.kind,DERIVED_KIND);
  assert.equal(record.inputs,sourceAddress,'the source is a weak reference: a plain address, not a link');
  assert.equal(record.version,3);
  assert.equal(record.sourceEvidenceId,sourceId);
  assert.deepEqual(record.scienceState,{'/':result.revision});
  for(const copied of ['local','observations','indices','stations','guidance','lamp'])assert.equal(record[copied],undefined);
  for(const recomputable of ['metrics','comparisons','pending','missingOutcomes'])assert.equal(record.science[recomputable],undefined);
  assert.ok(JSON.stringify(record).length<5000);
  const {id,address}=await putEvidence(root,record);
  assert.equal(id,sha(JSON.stringify(record)));
  const stored=await readEvidenceRecord({root,evidenceId:id});
  assert.equal(sha(JSON.stringify(stored.record)),id);
  assert.equal(stored.address,address);
  assert.equal((await putEvidence(root,record)).id,id,'idempotent');
  await assert.rejects(()=>readEvidenceRecord({root,evidenceId:'e'.repeat(64)}),{code:'ENOENT'});
  // The store refuses a link to a tree it does not hold.
  await assert.rejects(()=>putEvidence(root,{...record,scienceState:{'/':niOfHex('f'.repeat(64))}}),/not hold|missing|unknown/i);
  // ...but accepts a weak reference to a tree it does not hold.
  await putEvidence(root,{...record,inputs:niOfHex('f'.repeat(64))});
});

test('loader: gives every reader the fields it used to read; full detail re-derives the rest from the state tree',async t=>{
  const dir=await scratch(t),root=join(dir,'weather'),sciRoot=join(root,'station-science');
  await science(sciRoot,T0,source(T0),(await putEvidence(root,source(T0),{source:true})).id);
  const later=source(T0+3*HOUR,{readings:readingsFor(T0+HOUR,T0+3*HOUR)});
  const {id:sourceId2,address:sourceAddress2}=await putEvidence(root,later,{source:true});
  const evidence={...later};
  evidence.dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70}],gaps:[]};
  evidence.science=await science(sciRoot,T0+3*HOUR,evidence,sourceId2);
  evidence.sourceEvidenceId=sourceId2;
  const {id}=await putEvidence(root,sealDerivedRecord({sourceEvidenceId:sourceId2,sourceAddress:sourceAddress2,at:evidence.at,dailyExtremes:evidence.dailyExtremes,science:evidence.science}));
  const original=json(evidence);

  const used=await loadWeatherEvidence({root,evidenceId:id});
  for(const key of ['at','stations','local','observations','errors','indices','dailyExtremes','sourceEvidenceId'])assert.deepEqual(used[key],original[key],key);
  assert.deepEqual(Object.keys(used).slice(-3),['dailyExtremes','science','sourceEvidenceId'],'original key order');
  assert.equal(used.science.at,original.science.at);
  assert.equal(used.science.scored,original.science.scored);
  assert.equal(used.science.forecasted,original.science.forecasted);
  const usedKeys=Object.keys(original.science.parameters).filter(k=>k.startsWith('index:')||k.includes('/lamp-hourly-v2.7-v1/'));
  assert.deepEqual(Object.keys(used.science.parameters).sort(),usedKeys.sort());
  assert.deepEqual(used.science.forecasts,original.science.forecasts.filter(isUsedForecast));

  const full=await loadWeatherEvidence({root,evidenceId:id,detail:'full'});
  const {revision:_r,outcomesRef:_o,...originalScience}=original.science;
  assert.deepEqual(json(full.science),originalScience,'metrics, comparisons, parameters, every forecast and the outcomes are re-derived exactly');

  const whole=await weatherEvidence({root,evidenceId:id});
  assert.deepEqual(whole.local,original.local);
  const perStation=await weatherEvidence({root,evidenceId:id,station:'KNYC'});
  assert.deepEqual(json(perStation.science.metrics),original.science.metrics.filter(r=>r.station==='KNYC'));
  assert.deepEqual(json(perStation.science.forecasts),original.science.forecasts.filter(r=>r.station==='KNYC'));
  assert.deepEqual(json(perStation.science.outcomes),original.science.outcomes.filter(r=>r.forecast.station==='KNYC'));
  assert.deepEqual(perStation.local,original.local.KNYC);
  assert.deepEqual(perStation.dailyExtremes.forecasts,original.dailyExtremes.forecasts);
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:sourceId2}),json(later));
  // Retention is reachability: after gc every past revision a derived record links is still there.
  await evidenceStore(root).gc({graceMs:0});
  assert.deepEqual(json((await loadWeatherEvidence({root,evidenceId:id,detail:'full'})).science),originalScience);
  const check=await evidenceStore(root).fsck();
  assert.deepEqual([check.damaged,check.missing],[[],[]]);
});

test('loader: records that are not derived come back exactly as stored, from an archive file',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'evidence'),{recursive:true});
  const participation={kind:'weather-participation-snapshot-v1',at:'2026-10-10T12:00:00Z',rows:[{ticker:'T',book:{yes_dollars:[['0.5','2']]}}]};
  const id=sha(JSON.stringify(participation));
  await writeFile(join(root,'evidence',id+'.json.gz'),gzipSync(JSON.stringify(participation)));
  assert.deepEqual(await weatherEvidence({root,evidenceId:id}),participation);
  assert.equal(sha(JSON.stringify(await weatherEvidence({root,evidenceId:id}))),id,'participation readers verify their snapshot digest');
  const bad=sha('something else');
  await writeFile(join(root,'evidence',bad+'.json.gz'),gzipSync(JSON.stringify(participation)));
  await assert.rejects(()=>weatherEvidence({root,evidenceId:bad}),/hash mismatch/);
});

/** A packet exactly as the old archiveWeatherEvidence wrote it, made with a scratch weather root so the real one stays untouched. */
const legacyDerived=async(root,now)=>{
  const scratchRoot=await mkdtemp(join(tmpdir(),'weather-legacy-'));
  const src=source(now,{readings:readingsFor(now-2*HOUR,now)});
  const sourceEvidenceId=sha(JSON.stringify(src));
  const evidence={...src};
  evidence.dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70+now%7}],gaps:[]};
  evidence.science=json(await updateStationScience(evidence,{root:join(scratchRoot,'station-science'),store:evidenceStore(scratchRoot),now,sourceEvidenceId}));
  delete evidence.science.revision;delete evidence.science.outcomesRef;
  await rm(scratchRoot,{recursive:true,force:true});
  evidence.sourceEvidenceId=sourceEvidenceId;
  const text=JSON.stringify(evidence),id=sha(text);
  await writeFile(join(root,'evidence',id+'.json.gz'),gzipSync(text));
  return {id,evidence:JSON.parse(text),sourceEvidenceId,src};
};

test('migration: dry run frees nothing and reports; apply verifies, keeps the science, removes, and old ids still resolve',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'evidence'),{recursive:true});
  const a=await legacyDerived(root,T0);
  const b=await legacyDerived(root,T0+HOUR);
  const indexSource={kind:'kalshi-weather-index-source',at:'2026-10-10T12:01:00Z',indices:{nyc:{points:[1,2,3]}},errors:[],stationEvidenceId:a.id};
  const indexId=sha(JSON.stringify(indexSource));
  await writeFile(join(root,'evidence',indexId+'.json.gz'),gzipSync(JSON.stringify(indexSource)));
  const participation={kind:'weather-participation-review-v1',at:'2026-10-10T12:00:00Z',rows:[]};
  const participationId=sha(JSON.stringify(participation));
  await writeFile(join(root,'evidence',participationId+'.json.gz'),gzipSync(JSON.stringify(participation)));
  const damaged=sha('damaged');
  await writeFile(join(root,'evidence',damaged+'.json.gz'),gzipSync('{"not":"its digest"}'));
  await mkdir(join(root,'scores'));
  const done={id:'1'.repeat(64),outcome:1},open={id:'2'.repeat(64),outcome:0};
  await writeFile(join(root,'resolved.jsonl'),JSON.stringify(done)+'\n');
  await writeFile(join(root,'scores',done.id+'.json'),JSON.stringify(done)+'\n');
  await writeFile(join(root,'scores',open.id+'.json'),JSON.stringify(open)+'\n');

  const before=(await readdir(join(root,'evidence'))).sort();
  const dry=await migrateWeatherEvidence({root});
  assert.equal(dry.apply,false);
  assert.deepEqual((await readdir(join(root,'evidence'))).sort(),before,'dry run removes nothing');
  await assert.rejects(()=>stat(join(root,'content-tree')),{code:'ENOENT'},'dry run writes nothing under the root');
  assert.equal(dry.derivedMigrated,2);assert.equal(dry.sourcesMigrated,1);
  assert.deepEqual(dry.left,{'weather-participation-review-v1':1});
  assert.deepEqual(dry.corrupt,[damaged]);
  assert.deepEqual(dry.failed,[]);
  assert.equal(typeof dry.evidenceBytesFreed,'number');
  assert.equal(dry.scores.files,1);

  const done1=await migrateWeatherEvidence({root,apply:true});
  assert.equal(done1.evidenceBytesFreed,dry.evidenceBytesFreed,'the dry run predicted the freed bytes');
  assert.deepEqual((await readdir(join(root,'evidence'))).sort(),[damaged+'.json.gz',participationId+'.json.gz'].sort());
  assert.deepEqual((await readdir(join(root,'scores'))),[open.id+'.json']);

  for(const old of [a,b]){
    const loaded=await loadWeatherEvidence({root,evidenceId:old.id});
    for(const key of Object.keys(old.src))assert.deepEqual(loaded[key],old.evidence[key],key);
    assert.deepEqual(loaded.dailyExtremes,old.evidence.dailyExtremes);
    assert.equal(loaded.sourceEvidenceId,old.sourceEvidenceId);
    assert.deepEqual(loaded.science.forecasts,old.evidence.science.forecasts.filter(isUsedForecast));
    // Nothing the packet held is dropped: metrics, comparisons, every forecast, the outcomes.
    const full=await loadWeatherEvidence({root,evidenceId:old.id,detail:'full'});
    assert.deepEqual(full.science,old.evidence.science);
    const station=await weatherEvidence({root,evidenceId:old.id,station:'KNYC'});
    assert.deepEqual(station.science.outcomes,old.evidence.science.outcomes.filter(r=>r.forecast.station==='KNYC'));
    assert.deepEqual(station.science.metrics,old.evidence.science.metrics.filter(r=>r.station==='KNYC'));
  }
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:indexId}),indexSource);
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:participationId}),participation);
  const again=await migrateWeatherEvidence({root,apply:true});
  assert.equal(again.derivedMigrated+again.sourcesMigrated,0);
  const check=await evidenceStore(root).fsck();
  assert.deepEqual([check.damaged,check.missing],[[],[]]);
});

test('migration refuses what it cannot verify and keeps that file',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'evidence'),{recursive:true});
  const a=await legacyDerived(root,T0);
  const tampered={...a.evidence,sourceEvidenceId:'f'.repeat(64)};
  const text=JSON.stringify(tampered),id=sha(text);
  await writeFile(join(root,'evidence',id+'.json.gz'),gzipSync(text));
  const result=await migrateWeatherEvidence({root,apply:true});
  assert.equal(result.failed.length,1);
  assert.equal(result.failed[0].id,id);
  assert.ok((await readdir(join(root,'evidence'))).includes(id+'.json.gz'));
});

test('alias: a successor must name its predecessor',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  const {address}=await putEvidence(root,{kind:'x',at:'t'});
  await putEvidenceAlias(root,{from:'a'.repeat(64),address});
  await assert.rejects(()=>readEvidenceRecord({root,evidenceId:'a'.repeat(64)}),/does not name its predecessor/);
  const {address:real}=await putEvidence(root,{kind:'x',at:'t2',supersedes:'b'.repeat(64)});
  await putEvidenceAlias(root,{from:'b'.repeat(64),address:real});
  assert.equal((await readEvidenceRecord({root,evidenceId:'b'.repeat(64)})).record.at,'t2');
});

test('desk: pending, grades and latest are trees; scores go once appended; readers get the joined record',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'scores'),{recursive:true});
  const ruleKey=sha('rule'),rulesHash=sha('rules');
  const forecast={id:'f'.repeat(64),ticker:'T1',family:'hourly-temperature',source:'s',station:'index:test',ruleKey,rulesHash,stage:'0-6h',eventTicker:'E',targetDate:'2026-10-06',closeTime:'2026-10-06T20:00:00Z',at:'2026-10-06T18:00:00Z',mid:.5,models:[{id:'m',p:.6}]};
  const {id,...pending}=forecast;
  const market={ticker:'T1',status:'finalized',result:'yes',settlement_ts:'2026-10-06T21:00:00Z',close_time:'2026-10-06T20:00:00Z',market_type:'binary',rules_primary:'p',rules_secondary:'s'};
  const client={getMarkets:async()=>[market]};
  const {digest}=await import('../src/weather-universe.mjs');
  pending.rulesHash=digest({primary:'p',secondary:'s'});
  await writeFile(join(root,'pending.json'),JSON.stringify({[id]:pending}));
  const first=await scoreWeather({root,client,now:Date.parse('2026-10-07T00:00:00Z')});
  const store=evidenceStore(root);
  await assert.rejects(()=>stat(join(root,'pending.json')),{code:'ENOENT'},'legacy pending.json replaced by its tree');
  assert.equal(first.errors.length,0,JSON.stringify(first.errors));
  assert.equal(first.pending,0);assert.equal(first.settled,1);
  assert.deepEqual((await store.get(await store.getRef('weather/pending'))).rows,{});
  const resolved=(await readFile(join(root,'resolved.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(resolved.length,1);assert.equal(resolved[0].id,id);
  assert.deepEqual(await readdir(join(root,'scores')),[],'a score file goes once it is in resolved.jsonl');
  // Unchanged grades do not move their ref.
  const gradesRef=await store.getRef('weather/grades');
  await scoreWeather({root,client,now:Date.parse('2026-10-07T00:00:00Z')});
  assert.equal(await store.getRef('weather/grades'),gradesRef);
  // latest is a tree whose grades and science are links.
  const revision=await store.put({at:'2026-10-10T12:00:00.000Z',pending:{},history:{},comparisons:{},missingOutcomes:0});
  const latestRoot=await saveTree(store,'weather/latest',{science:{at:'2026-10-10T12:00:00.000Z',scored:1,forecasted:2,revision:{'/':revision}},grades:{'/':gradesRef},at:'2026-10-10T12:00:00Z',contracts:[],forecasts:[]});
  const status=await weatherStatus({root,science:false});
  assert.deepEqual(status.grades,await store.get(gradesRef));
  assert.equal((await weatherStatus({root})).science.revision,revision);
  assert.ok((await weatherStatus({root})).science.metrics,'science is re-derived from the linked state');
  const joined=await readLatest({root});
  assert.equal(joined.source.revision,latestRoot);
  const page=await weatherStatusPage({root,field:'grades',limit:5});
  assert.equal(page.source.revision,latestRoot);
  await assert.rejects(()=>weatherStatusPage({root,field:'grades',sourceRevision:'ni:///sha-256;'+'A'.repeat(43)}),/revision changed/);
});

test('latest.json written before trees is still read, with inline grades untouched',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(root,{recursive:true});
  await writeFile(join(root,'latest.json'),JSON.stringify({at:'2026-10-10T12:00:00Z',grades:{k:{admitted:true}}}));
  assert.deepEqual((await weatherStatus({root})).grades,{k:{admitted:true}});
});

test('station skill page reads the state tree',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  const result=await science(join(root,'station-science'),T0,source(T0),'a'.repeat(64));
  const page=await weatherStationSkillPage({root,field:'parameters',limit:5});
  assert.equal(page.field,'parameters');
  assert.equal(page.source.revision,result.revision);
});

test('weatherStoreGc keeps what refs and links reach',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  const {id}=await putEvidence(root,{kind:'x',at:'t'});
  const result=await weatherStoreGc({root,graceMs:0});
  assert.equal(typeof result.kept,'number');
  assert.equal((await readEvidenceRecord({root,evidenceId:id})).record.at,'t');
});

test('run hoisting: a run\'s shared stamp and lead hours are stored once, losslessly, and unchanged rows repeat byte for byte',()=>{
  const valid='2026-10-10T15:00:00.000Z';
  const row=(stamp,model,mean)=>({station:'index:nyc',model,validTime:valid,meanF:mean,leadHours:(Date.parse(valid)-Date.parse(stamp))/3600000,availableAt:stamp,
    learning:{fitAvailableAt:stamp,outcomeReceiptBoundAt:stamp,matchedDates:7},comparators:[{validTime:valid,leadHours:(Date.parse(valid)-Date.parse(stamp))/3600000,availableAt:stamp}],
    relational:{availableAt:'2026-10-10T11:58:00.000Z'}});
  const a='2026-10-10T12:00:00.123Z',b='2026-10-10T12:15:00.456Z';
  const A=hoistRun([row(a,'m',60),row(a,'n',61)],a),B=hoistRun([row(b,'m',60),row(b,'n',61.5)],b);
  assert.equal(A.hoisted,true);
  assert.equal(JSON.stringify(A.value[0]),JSON.stringify(B.value[0]),'an unchanged row is identical across runs');
  assert.notEqual(JSON.stringify(A.value[1]),JSON.stringify(B.value[1]));
  assert.equal(A.value[0].relational.availableAt,'2026-10-10T11:58:00.000Z','a row\'s own receipt time is kept');
  assert.equal(A.value[0].leadHours,null);
  assert.equal(JSON.stringify(unhoistRun(A.value,a)),JSON.stringify([row(a,'m',60),row(a,'n',61)]));
  assert.equal(hoistRun([{note:'@run'}],a).hoisted,false);
  assert.equal(hoistRun([{validTime:a,leadHours:null}],a).hoisted,false);
  const odd={validTime:valid,leadHours:9};
  assert.deepEqual(unhoistRun(hoistRun([odd],a).value,a),[odd]);
});

test('retention: raw sources get dated weak refs and age out a day per call; derived records keep what they link',async t=>{
  const dir=await scratch(t),root=join(dir,'weather'),sciRoot=join(root,'station-science');
  const day=86400000,now=Date.parse('2026-10-20T12:00:00Z');
  const oldSource=source(now-18*day),recentSource=source(now-2*day);
  const old=await putEvidence(root,oldSource,{source:true}),recent=await putEvidence(root,recentSource,{source:true});
  assert.equal(old.ref,sourceRefName('2026-10-02',old.id));
  assert.equal(await evidenceStore(root).getRef('evidence/'+old.id),undefined,'a source has no strong ref');
  await science(sciRoot,now-18*day-3*3600000,source(now-18*day-3*3600000),old.id);
  const scored=source(now-18*day,{readings:readingsFor(now-18*day-2*3600000,now-18*day)});
  const result=await science(sciRoot,now-18*day,{...scored},old.id);
  assert.ok(result.scored>0);
  const derived=await putEvidence(root,sealDerivedRecord({sourceEvidenceId:old.id,sourceAddress:old.address,at:oldSource.at,dailyExtremes:{forecasts:[],gaps:[]},science:result}));
  assert.equal((await loadWeatherEvidence({root,evidenceId:derived.id})).sourceEvidenceId,old.id);
  assert.equal((await readEvidenceRecord({root,evidenceId:recent.id,dateHint:'2026-10-18'})).record.at,recentSource.at);
  assert.equal(sourceRetentionDays({}),14);assert.equal(sourceRetentionDays({KALSHI_WEATHER_SOURCE_RETENTION_DAYS:'3'}),3);
  assert.throws(()=>sourceRetentionDays({KALSHI_WEATHER_SOURCE_RETENTION_DAYS:'0'}),RangeError);
  assert.deepEqual(await expireSources({root,now,retentionDays:14}),{date:'2026-10-02',removed:1});
  assert.deepEqual(await expireSources({root,now,retentionDays:14}),{date:null,removed:0});
  assert.equal((await readEvidenceRecord({root,evidenceId:recent.id})).record.at,recentSource.at);
  await evidenceStore(root).gc({graceMs:0});
  await assert.rejects(()=>loadWeatherEvidence({root,evidenceId:derived.id}),{code:'WEATHER_SOURCE_AGED_OUT'});
  const store=evidenceStore(root),record=(await readEvidenceRecord({root,evidenceId:derived.id})).record;
  assert.ok((await scienceStateAt(store,record.scienceState['/'])).state);
  assert.deepEqual(await store.get(record.science.outcomes['/']),json(result.outcomes));
  const check=await store.fsck();
  assert.deepEqual([check.damaged,check.missing],[[],[]]);

  // Ageing: past its working window a derived record keeps its readers' fields and drops its hold on the state revision.
  await indexDerived(root,{id:derived.id,at:oldSource.at});
  const before=await loadWeatherEvidence({root,evidenceId:derived.id,detail:'used'}).catch(error=>error);
  assert.equal((await ageDerived({root,now,workingWindowDays:7})).aged,1);
  assert.equal(await store.getRef('evidence/'+derived.id),undefined,'the strong ref is gone');
  const aged=(await readEvidenceRecord({root,evidenceId:derived.id})).record;
  assert.equal(aged.scienceState,null);assert.equal(aged.scienceStateAged,true);assert.equal(aged.supersedes,derived.id);
  assert.equal(aged.scienceStateAddress,record.scienceState['/'],'the revision is named, weakly');
  assert.deepEqual(await store.get(aged.science.outcomes['/']),json(result.outcomes),'outcomes stay linked');
  // the source had aged out above, so detail used reports that; the aged record reports the same thing, not something new
  assert.equal(before.code,'WEATHER_SOURCE_AGED_OUT');
  await assert.rejects(()=>loadWeatherEvidence({root,evidenceId:derived.id,detail:'used'}),{code:'WEATHER_SOURCE_AGED_OUT'});
  assert.equal((await ageDerived({root,now,workingWindowDays:7})).aged,0,'nothing left to age');
  // a record whose revision is gone says so for detail full
  const gone=ageDerivedRecord(record,derived.id);gone.scienceStateAddress=niOfHex('0'.repeat(64));
  await store.setRef('alias/'+'f'.repeat(64),await store.put({...gone,supersedes:'f'.repeat(64)}));
  await assert.rejects(()=>loadWeatherEvidence({root,evidenceId:'f'.repeat(64),detail:'full'}),(error)=>['WEATHER_STATE_AGED_OUT','WEATHER_SOURCE_AGED_OUT'].includes(error.code));
});

test('maintainStore: each cycle expires what is past the window and reclaims after an expiry, and not otherwise',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  const day=86400000,now=Date.parse('2026-10-20T12:00:00Z');
  await putEvidence(root,source(now-20*day),{source:true});await putEvidence(root,source(now-19*day),{source:true});await putEvidence(root,source(now-2*day),{source:true});
  const first=await maintainStore({root,now,retentionDays:14});
  assert.equal(first.expired.removed,2,'both days past the window go in one cycle (expiryDaysPerCycle)');assert.ok(first.gc,'gc ran after an expiry');
  const second=await maintainStore({root,now:now+60000,retentionDays:14});
  assert.deepEqual([second.expired,second.gc],[{date:null,removed:0},null],'nothing due, nothing done, and no timer decides otherwise');
  // growth alone also brings a gc: the packs gaining policy.gcAfterGrowthBytes since the last one
  const policy={...readRetentionPolicy(),gcAfterGrowthBytes:1};
  await putEvidence(root,source(now-1*day),{source:true});
  const third=await maintainStore({root,now:now+120000,retentionDays:14,policy});
  assert.ok(third.gc,'the store grew past the policy, so gc ran');
  assert.ok((await readEvidenceRecord({root,evidenceId:jsonDigest(source(now-2*day))})).record.at,'a source inside the window is kept');
});

test('retention: the window is the longest the measured growth lets the store stay within its budget, and the policy is typed',()=>{
  const policy=readRetentionPolicy(),gb=1073741824;
  assert.equal(retentionWindow({policy,growthBytesPerDay:null}),policy.sourceRetentionMaxDays,'unknown growth: the design\'s window');
  assert.equal(retentionWindow({policy,growthBytesPerDay:policy.storeBudgetBytes/10}),10);
  assert.equal(retentionWindow({policy,growthBytesPerDay:1}),policy.sourceRetentionMaxDays,'never longer than the design allows');
  assert.equal(retentionWindow({policy,growthBytesPerDay:393e6}),Math.max(policy.sourceRetentionMinDays,Math.floor(policy.storeBudgetBytes/393e6)),'the measured 393 MB a day');
  assert.equal(retentionWindow({policy,growthBytesPerDay:50*gb}),policy.sourceRetentionMinDays,'never shorter than the minimum');
  assert.throws(()=>readRetentionPolicy({...policyFile,gcAfterGrowthBytes:'64 MiB'}),RangeError);
  assert.throws(()=>readRetentionPolicy({...policyFile,sourceRetentionMinDays:30}),RangeError);
  const {graceMsBasis:_,...unfounded}=policyFile;assert.throws(()=>readRetentionPolicy(unfounded),/basis/u);
});

test('retention: the cycle measures growth from the bytes the packs gained since the last gc finished',async()=>{
  const policy=readRetentionPolicy(),day=86400000,now=Date.parse('2026-10-20T12:00:00Z'),calls=[];
  const run=(state,bytes,args={})=>upkeep({policy,state,now,bytesOf:async()=>bytes,expire:async d=>{calls.push(d);return {date:null,removed:0};},gc:async()=>({kept:1,removed:0,major:false}),...args});
  const first=await run(null,1000);
  assert.ok(first.gcRan,'the first upkeep reclaims once, to start its record');assert.equal(first.state.bytesAfter,1000);
  const grown=await run({at:new Date(now-day/2).toISOString(),bytesAfter:0,growthBytesPerDay:null},policy.storeBudgetBytes/3);
  assert.equal(Math.round(grown.growthBytesPerDay/policy.storeBudgetBytes*100),67,'a third of the budget in half a day is two thirds a day');
  assert.equal(grown.window,Math.max(policy.sourceRetentionMinDays,1));
  assert.deepEqual(calls.at(-1),grown.window,'and that window is what expiry is asked for');
  const quick=await run({at:new Date(now-1000).toISOString(),bytesAfter:0,growthBytesPerDay:5},1e12);
  assert.equal(quick.growthBytesPerDay,5,'a second is too little time to measure a rate; the earlier estimate stands');
});
