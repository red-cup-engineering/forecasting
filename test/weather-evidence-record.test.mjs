import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir,mkdir,stat,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {makeNiUri} from '@red-cup-engineering/uri-services-section/ni-uri';
import {openLedger,readLedger,findRevision,readOutcomes,forgetLedgerCache,niOf,niOfHex,hexOfNi} from '../src/weather-ledger.mjs';
import {updateStationScience,readStationScience,readStationSciencePage,readScienceState,stationScienceReport} from '../src/station-weather-science.mjs';
import {sealDerivedRecord,putEvidence,readEvidenceRecord,loadWeatherEvidence,appendEvidenceAlias,DERIVED_KIND,isUsedForecast} from '../src/weather-evidence-record.mjs';
import {migrateWeatherEvidence} from '../src/weather-evidence-migration.mjs';
import {weatherEvidence,weatherStatus,weatherStatusPage,readLatest,scoreWeather,weatherStationSkillPage} from '@red-cup-engineering/forecasting/weather-engine';

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

test('ni names: native digest, hex round trip, and agreement with the house makeNiUri',()=>{
  const bytes=Buffer.from('weather');
  assert.equal(niOf(bytes),makeNiUri(new Uint8Array(bytes)));
  assert.equal(hexOfNi(niOfHex(sha('weather'))),sha('weather'));
  assert.throws(()=>hexOfNi('ni:///sha-256;short'),TypeError);
  assert.throws(()=>niOfHex('xyz'),TypeError);
});

test('ledger: commits store only changes, replay equals the state, the chain is the revision',async t=>{
  const dir=await scratch(t);
  let led=await openLedger(dir);
  assert.equal(led.head,null);
  const first=await led.commit({set:{rows:{a:{n:1},b:{n:2}}},put:{at:'t1'},at:'t1'});
  led=await openLedger(dir);
  const second=await led.commit({set:{rows:{c:{n:3}}},del:{rows:['a']},put:{at:'t2'},at:'t2',outcomes:[{id:'x',errorF:1}]});
  assert.notEqual(first.revision,second.revision);
  forgetLedgerCache();
  const {head,state}=await readLedger(dir);
  assert.deepEqual(state,{rows:{b:{n:2},c:{n:3}},at:'t2'});
  assert.equal(head.revision,second.revision);
  // The revision is the ni name of the exact entry line, and the entry names its parent.
  const found=await findRevision(dir,first.revision);
  assert.deepEqual(found.state,{rows:{a:{n:1},b:{n:2}},at:'t1'});
  assert.equal((await findRevision(dir,second.revision)).entry.parent,first.revision);
  assert.equal(await findRevision(dir,niOf(Buffer.from('nothing'))),null);
  assert.deepEqual(await readOutcomes(dir,second.outcomes.ni),[{id:'x',errorF:1}]);
  // An empty change is not a revision.
  led=await openLedger(dir);
  const none=await led.commit({set:{rows:{}}});
  assert.equal(none.unchanged,true);assert.equal((await readLedger(dir)).head.revision,second.revision);
});

test('ledger: an uncommitted tail is ignored and overwritten; a damaged segment is refused',async t=>{
  const dir=await scratch(t);
  let led=await openLedger(dir);
  const first=await led.commit({set:{rows:{a:1}},at:'t1'});
  await appendFile(join(dir,'segments','000001.jsonl.gz'),gzipSync(Buffer.from('{"parent":"torn"}\n')));
  forgetLedgerCache();
  assert.deepEqual((await readLedger(dir)).state,{rows:{a:1}});
  led=await openLedger(dir);
  await led.commit({set:{rows:{b:2}},at:'t2'});
  forgetLedgerCache();
  const {head,state}=await readLedger(dir);
  assert.deepEqual(state,{rows:{a:1,b:2}});
  assert.notEqual(head.revision,first.revision);
  // Damage the segment: the chain no longer reaches the head.
  await writeFile(join(dir,'head.json'),JSON.stringify({...head,revision:niOf(Buffer.from('forged'))}));
  forgetLedgerCache();
  await assert.rejects(()=>readLedger(dir),/does not match/);
});

test('ledger: a segment that outgrows its snapshot rolls over; old revisions stay reachable until pruned',async t=>{
  const dir=await scratch(t);
  const big='x'.repeat(2*1024*1024);
  let led=await openLedger(dir);
  const revisions=[];
  let rolled=false;
  for(let i=0;i<40&&!rolled;i++){
    led=await openLedger(dir);
    const done=await led.commit({set:{rows:{[`r${i}`]:{big:big+i}}},at:`t${i}`,keepSegments:3});
    revisions.push(done.revision);rolled=done.rolledOver;
  }
  assert.equal(rolled,true);
  assert.deepEqual(await readdir(join(dir,'segments')),['000001.jsonl.gz','000002.jsonl.gz']);
  const {state}=await readLedger(dir);
  assert.equal(Object.keys(state.rows).length,revisions.length);
  const old=await findRevision(dir,revisions[0]);
  assert.deepEqual(Object.keys(old.state.rows),['r0']);
  forgetLedgerCache();
  assert.equal(Object.keys((await readLedger(dir)).state.rows).length,revisions.length);
});

const science=async(root,now,evidence,sourceEvidenceId)=>updateStationScience(evidence,{root,now,sourceEvidenceId});

test('station science: scores, learns and records by change; the report reads back from the ledger',async t=>{
  const dir=await scratch(t),root=join(dir,'station-science');
  const first=await science(root,T0,source(T0),'a'.repeat(64));
  assert.ok(first.forecasted>0&&first.scored===0);
  const second=await science(root,T0+3*HOUR,source(T0+3*HOUR,{readings:readingsFor(T0+HOUR,T0+3*HOUR)}),'b'.repeat(64));
  assert.ok(second.scored>0);
  assert.notEqual(second.revision,first.revision);
  // A cycle writes its changes: far less than the state it changed.
  const {state}=await readScienceState(root);
  assert.ok(second.ledger.bytesWritten<JSON.stringify(state).length);
  // The head report equals the report the update returned.
  const report=await readStationScience({root});
  const returned=stationScienceReport(state);
  assert.deepEqual(json(report),json(returned));
  assert.equal(report.pending,Object.keys(state.pending).length);
  assert.deepEqual(Object.keys(state).sort().filter(k=>k!=='parameters'),['at','comparisons','history','missingOutcomes','pending']);
  // Every scored forecast kept its forecast/observation pair in the lineage.
  const lineage=await readOutcomes(root,second.outcomesRef.ni);
  assert.equal(lineage.length,second.scored);
  assert.deepEqual(json(second.outcomes),lineage);
  // Paging is bound to the ledger head.
  const page=await readStationSciencePage({root,field:'metrics',limit:5});
  assert.equal(page.source.revision,second.revision);
  await science(root,T0+4*HOUR,source(T0+4*HOUR),'c'.repeat(64));
  await assert.rejects(()=>readStationSciencePage({root,field:'metrics',limit:5,sourceRevision:page.source.revision}),/revision changed/);
});

test('station science: a pre-ledger state.json is imported, verified against the ledger and removed',async t=>{
  const dir=await scratch(t),root=join(dir,'station-science');
  await mkdir(root,{recursive:true});
  const legacy={pending:{p1:{station:'KNYC',model:'m',validTime:'2026-10-10T20:00:00.000Z',meanF:60,scaleF:2,horizon:'3-6h',date:'2026-10-10',availableAt:'2026-10-10T12:00:00.000Z',nu:5}},
    history:{},comparisons:{},missingOutcomes:3,parameters:{'KNYC/m/3-6h':{ready:true}},at:'2026-10-10T12:00:00.000Z'};
  await writeFile(join(root,'state.json'),JSON.stringify(legacy));
  // Before the first update the legacy file is still readable.
  assert.equal((await readStationScience({root})).pending,1);
  await science(root,T0+HOUR,source(T0+HOUR),'d'.repeat(64));
  await assert.rejects(()=>stat(join(root,'state.json')),{code:'ENOENT'});
  forgetLedgerCache();
  const {state}=await readLedger(root);
  assert.equal(state.missingOutcomes,3);
  assert.ok(state.pending.p1);
  assert.equal(state.parameters,undefined,'parameters are refit from history, never stored');
});

test('derived record: ids are sha-256 of the record JSON, inputs are names, nothing is copied',async t=>{
  const dir=await scratch(t),root=join(dir,'weather'),sciRoot=join(root,'station-science');
  const src=source(T0);
  const sourceId=await putEvidence(root,src);
  assert.equal(sourceId,sha(JSON.stringify(src)));
  const result=await science(sciRoot,T0,{...src},sourceId);
  const dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70}],gaps:[]};
  const record=sealDerivedRecord({sourceEvidenceId:sourceId,at:src.at,dailyExtremes,science:result});
  assert.equal(record.kind,DERIVED_KIND);
  assert.equal(record.inputs,niOfHex(sourceId));
  assert.equal(record.scienceRevision,result.revision);
  for(const copied of ['local','observations','indices','stations','guidance','lamp'])assert.equal(record[copied],undefined);
  for(const recomputable of ['metrics','comparisons','pending','missingOutcomes'])assert.equal(record.science[recomputable],undefined);
  assert.ok(JSON.stringify(record).length<JSON.stringify(src).length/2||JSON.stringify(record).length<5000);
  const id=await putEvidence(root,record);
  assert.equal(id,sha(JSON.stringify(record)));
  const stored=await readEvidenceRecord({root,evidenceId:id});
  assert.equal(sha(JSON.stringify(stored.record)),id);
  assert.equal(await putEvidence(root,record),id,'idempotent');
  await assert.rejects(()=>readEvidenceRecord({root,evidenceId:'e'.repeat(64)}),{code:'ENOENT'});
});

test('loader: gives every reader the fields it used to read; full detail re-derives the rest from the ledger',async t=>{
  const dir=await scratch(t),root=join(dir,'weather'),sciRoot=join(root,'station-science');
  const sourceId1=await putEvidence(root,source(T0));
  await science(sciRoot,T0,source(T0),sourceId1);
  const later=source(T0+3*HOUR,{readings:readingsFor(T0+HOUR,T0+3*HOUR)});
  const sourceId2=await putEvidence(root,later);
  const evidence={...later};
  evidence.dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70}],gaps:[]};
  evidence.science=await science(sciRoot,T0+3*HOUR,evidence,sourceId2);
  evidence.sourceEvidenceId=sourceId2;
  const id=await putEvidence(root,sealDerivedRecord({sourceEvidenceId:sourceId2,at:evidence.at,dailyExtremes:evidence.dailyExtremes,science:evidence.science}));
  // What the original (pre-change) packet held, as JSON.
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
  const {revision:_r,ledger:_l,outcomesRef:_o,...originalScience}=original.science;
  assert.deepEqual(json(full.science),originalScience,'metrics, comparisons, parameters, every forecast and the outcomes are re-derived exactly');

  // weatherEvidence: whole-record and per-station reads.
  const whole=await weatherEvidence({root,evidenceId:id});
  assert.deepEqual(whole.local,original.local);
  const perStation=await weatherEvidence({root,evidenceId:id,station:'KNYC'});
  assert.deepEqual(json(perStation.science.metrics),original.science.metrics.filter(r=>r.station==='KNYC'));
  assert.deepEqual(json(perStation.science.forecasts),original.science.forecasts.filter(r=>r.station==='KNYC'));
  assert.deepEqual(json(perStation.science.outcomes),original.science.outcomes.filter(r=>r.forecast.station==='KNYC'));
  assert.deepEqual(perStation.local,original.local.KNYC);
  assert.deepEqual(perStation.dailyExtremes.forecasts,original.dailyExtremes.forecasts);
  // A source id still loads as itself.
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:sourceId2}),json(later));
});

test('loader: records that are not derived come back exactly as stored, from the store or from an archive file',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'evidence'),{recursive:true});
  const participation={kind:'weather-participation-snapshot-v1',at:'2026-10-10T12:00:00Z',rows:[{ticker:'T',book:{yes_dollars:[['0.5','2']]}}]};
  const id=sha(JSON.stringify(participation));
  await writeFile(join(root,'evidence',id+'.json.gz'),gzipSync(JSON.stringify(participation)));
  assert.deepEqual(await weatherEvidence({root,evidenceId:id}),participation);
  assert.equal(sha(JSON.stringify(await weatherEvidence({root,evidenceId:id}))),id,'participation readers verify their snapshot digest');
  // A damaged archive is refused.
  const bad=sha('something else');
  await writeFile(join(root,'evidence',bad+'.json.gz'),gzipSync(JSON.stringify(participation)));
  await assert.rejects(()=>weatherEvidence({root,evidenceId:bad}),/hash mismatch/);
});

const legacyDerived=async(root,now,previous)=>{
  // A packet exactly as the old archiveWeatherEvidence wrote it: source + dailyExtremes + whole science + sourceEvidenceId.
  const src=source(now,{readings:readingsFor(now-2*HOUR,now)});
  const sourceEvidenceId=sha(JSON.stringify(src));
  const evidence={...src};
  evidence.dailyExtremes={forecasts:[{station:'KNYC',kind:'high',meanF:70+now%7}],gaps:[]};
  evidence.science=json(await science(join(root,'ledger-scratch'),now,evidence,sourceEvidenceId));
  delete evidence.science.revision;delete evidence.science.ledger;delete evidence.science.outcomesRef;
  evidence.sourceEvidenceId=sourceEvidenceId;
  const text=JSON.stringify(evidence),id=sha(text);
  await writeFile(join(root,'evidence',id+'.json.gz'),gzipSync(text));
  return {id,evidence:JSON.parse(text),sourceEvidenceId,src,bytes:gzipSync(text).length};
};

test('migration: dry run frees nothing and reports; apply verifies, then removes, and old ids still resolve',async t=>{
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
  // Scores: one already a line of resolved.jsonl, one not.
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
  assert.deepEqual((await readdir(join(root,'evidence'))).sort(),[damaged+'.json.gz',participationId+'.json.gz','aliases.jsonl'].sort());
  assert.deepEqual((await readdir(join(root,'scores'))),[open.id+'.json']);

  // The old derived ids still resolve and give readers the same fields.
  for(const old of [a,b]){
    const loaded=await loadWeatherEvidence({root,evidenceId:old.id});
    for(const key of Object.keys(old.src))assert.deepEqual(loaded[key],old.evidence[key],key);
    assert.deepEqual(loaded.dailyExtremes,old.evidence.dailyExtremes);
    assert.equal(loaded.sourceEvidenceId,old.sourceEvidenceId);
    assert.equal(loaded.science.at,old.evidence.science.at);
    assert.deepEqual(loaded.science.forecasts,old.evidence.science.forecasts.filter(isUsedForecast));
    const full=await weatherEvidence({root,evidenceId:old.id,station:'KNYC'});
    assert.deepEqual(json(full.science.outcomes),old.evidence.science.outcomes.filter(r=>r.forecast.station==='KNYC'));
    assert.equal(full.science.unavailable,'station-science revision is not retained');
  }
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:indexId}),indexSource);
  assert.deepEqual(await loadWeatherEvidence({root,evidenceId:participationId}),participation);
  // Running it again finds nothing more to do.
  const again=await migrateWeatherEvidence({root,apply:true});
  assert.equal(again.derivedMigrated+again.sourcesMigrated,0);
});

test('migration refuses what it cannot verify and keeps that file',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'evidence'),{recursive:true});
  const a=await legacyDerived(root,T0);
  // A derived packet whose embedded source does not hash to its sourceEvidenceId.
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
  await mkdir(join(root,'evidence'),{recursive:true});
  const id=await putEvidence(root,{kind:'x',at:'t'});
  await appendEvidenceAlias(root,{from:'a'.repeat(64),to:id});
  await assert.rejects(()=>readEvidenceRecord({root,evidenceId:'a'.repeat(64)}),/does not name its predecessor/);
});

test('desk: pending, scores, grades and latest are stored by change and read back whole',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await mkdir(join(root,'scores'),{recursive:true});
  const ruleKey=sha('rule'),rulesHash=sha('rules');
  const forecast={id:'f'.repeat(64),ticker:'T1',family:'hourly-temperature',source:'s',station:'index:test',ruleKey,rulesHash,stage:'0-6h',eventTicker:'E',targetDate:'2026-10-06',closeTime:'2026-10-06T20:00:00Z',at:'2026-10-06T18:00:00Z',mid:.5,models:[{id:'m',p:.6}]};
  const {id,...pending}=forecast;
  // A legacy pending.json is imported; the market has settled, so scoring removes the row and appends the score.
  await writeFile(join(root,'pending.json'),JSON.stringify({[id]:pending}));
  const market={ticker:'T1',status:'finalized',result:'yes',settlement_ts:'2026-10-06T21:00:00Z',close_time:'2026-10-06T20:00:00Z',market_type:'binary',rules_primary:'p',rules_secondary:'s'};
  const client={getMarkets:async()=>[market]};
  const {digest}=await import('../src/weather-universe.mjs');
  pending.rulesHash=digest({primary:'p',secondary:'s'});
  await writeFile(join(root,'pending.json'),JSON.stringify({[id]:pending}));
  const first=await scoreWeather({root,client,now:Date.parse('2026-10-07T00:00:00Z')});
  await assert.rejects(()=>stat(join(root,'pending.json')),{code:'ENOENT'},'legacy pending.json replaced by the ledger');
  assert.equal(first.errors.length,0,JSON.stringify(first.errors));
  assert.equal(first.pending,0);
  assert.equal(first.settled,1);
  const resolved=(await readFile(join(root,'resolved.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(resolved.length,1);assert.equal(resolved[0].id,id);
  assert.deepEqual(await readdir(join(root,'scores')),[],'a score file goes once it is in resolved.jsonl');
  // Unchanged grades are not rewritten.
  const gradesPath=join(root,'grades.json'),firstStat=await stat(gradesPath);
  await new Promise(r=>setTimeout(r,20));
  await scoreWeather({root,client,now:Date.parse('2026-10-07T00:00:00Z')});
  assert.equal((await stat(gradesPath)).mtimeMs,firstStat.mtimeMs);
  // latest.json keeps references, readers get the joined record.
  const latest={science:{at:'2026-10-10T12:00:00.000Z',scored:1,forecasted:2,revision:niOf(Buffer.from('r'))},gradesSource:'grades.json',at:'2026-10-10T12:00:00Z',contracts:[],forecasts:[]};
  await writeFile(join(root,'latest.json'),JSON.stringify(latest));
  const status=await weatherStatus({root,science:false});
  assert.deepEqual(status.grades,JSON.parse(await readFile(gradesPath,'utf8')));
  assert.equal(status.gradesSource,undefined);
  const joined=await readLatest({root});
  const page=await weatherStatusPage({root,field:'grades',limit:5});
  assert.equal(page.source.revision,joined.source.revision);
  assert.notEqual(joined.source.revision,makeNiUri(await readFile(join(root,'latest.json'))),'the revision names latest.json and grades.json together');
  await assert.rejects(()=>weatherStatusPage({root,field:'grades',sourceRevision:'ni:///sha-256;'+'A'.repeat(43)}),/revision changed/);
  // Inline grades of an older latest.json pass through untouched.
  await writeFile(join(root,'latest.json'),JSON.stringify({at:'2026-10-10T12:00:00Z',grades:{k:{admitted:true}}}));
  assert.deepEqual((await weatherStatus({root})).grades,{k:{admitted:true}});
});

test('station skill page reads the ledger head',async t=>{
  const dir=await scratch(t),root=join(dir,'weather');
  await science(join(root,'station-science'),T0,source(T0),'a'.repeat(64));
  const page=await weatherStationSkillPage({root,field:'parameters',limit:5});
  assert.equal(page.field,'parameters');
  assert.match(page.source.revision,/^ni:\/\/\/sha-256;/u);
});
