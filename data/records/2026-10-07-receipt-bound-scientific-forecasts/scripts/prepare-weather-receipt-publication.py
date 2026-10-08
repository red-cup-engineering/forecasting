from pathlib import Path
import json,hashlib,subprocess,uuid
repo=Path('/home/emsenn/info');f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=f/'data/records/2026-10-07-receipt-bound-scientific-forecasts';r.mkdir(parents=True,exist_ok=True);(r/'scripts').mkdir(exist_ok=True);Path('/tmp/weather-receipt-publication-record').write_text(str(r));changes=[]
p=f/'src/station-weather-science.mjs';before=p.read_text();after=before;replacements=[]
def replace(old,new):
 global after
 if after.count(old)==0: old=old.replace('\n  ','\n '); old=old[1:] if old.startswith('  ') else old
 assert after.count(old)==1,old[:90];after=after.replace(old,new);replacements.append({'before':old,'after':new})
replace("import {open,mkdir,rename,rm} from 'node:fs/promises';", "import {open,mkdir,rename,rm,link,stat} from 'node:fs/promises';")
replace("import {createReadStream} from 'node:fs';", "import {createReadStream,createWriteStream} from 'node:fs';\nimport {pipeline} from 'node:stream/promises';\nimport {createGzip,createGunzip} from 'node:zlib';")
replace("import {createHash} from 'node:crypto';", "import {createHash,randomUUID} from 'node:crypto';")
replace("async function readStateJson(path){\n  const stream=createReadStream(path,{encoding:'utf8',highWaterMark:65536}),iterator=stream[Symbol.asyncIterator]();", "async function readStateJson(path,{compressed=false,onBytes}={}){\n  const input=createReadStream(path,{highWaterMark:65536}),stream=compressed?input.pipe(createGunzip()):input;if(compressed)input.on('error',e=>stream.destroy(e));if(onBytes)stream.on('data',onBytes);stream.setEncoding('utf8');const iterator=stream[Symbol.asyncIterator]();")
replace("}finally{stream.destroy();}\n}", "}finally{stream.destroy();input.destroy();}\n}")
replace("async function atomic(path,value){", "async function atomic(path,value,{newline=true}={}){")
replace("try{await map(value,true);await put('\\n');", "try{await map(value,true);if(newline)await put('\\n');")
anchor='function fit(history){'
helper='''// A frozen law becomes available when the immutable batch is linked, before
// registration writes the much larger learning state. Replay time is distinct.
async function publishForecastBatch(forecasts,{root,now,sourceEvidenceId,mode}){
 const generatedAt=new Date(now).toISOString(),records=Object.fromEntries(forecasts.map((r,i)=>{const {availableAt,...law}=r;return [String(i),{...law,generationAvailableAt:availableAt}];})),packet={kind:'station-forecast-publication-v1',mode,generatedAt,sourceEvidenceId:sourceEvidenceId??null,forecasts:records};
 await mkdir(root,{recursive:true,mode:0o700});const stem=join(root,'.forecast-'+randomUUID()),raw=stem+'.json',gz=stem+'.json.gz';
 try{
  await atomic(raw,packet,{newline:false});const digest=createHash('sha256'),input=createReadStream(raw);input.on('data',b=>digest.update(b));await pipeline(input,createGzip(),createWriteStream(gz,{flags:'wx',mode:0o600}));
  const evidenceId=digest.digest('hex');try{await link(gz,join(root,evidenceId+'.json.gz'));}catch(e){if(e.code!=='EEXIST')throw e;}
  // Date.now has millisecond resolution; use its conservative upper endpoint.
  const receivedAt=new Date(Date.now()+1).toISOString(),availableAt=mode==='replay'?generatedAt:receivedAt;
  return {evidenceId,mode,generatedAt,receivedAt,availableAt,clockResolutionMs:1,forecasts:forecasts.map((_,i)=>confirmedForecast(records[String(i)],{evidenceId,mode,generatedAt,receivedAt,availableAt,ordinal:i}))};
 }finally{await rm(raw,{force:true});await rm(gz,{force:true});}
}
function confirmedForecast(law,publication){
 const leadHours=(Date.parse(law.validTime)-Date.parse(publication.availableAt))/3600000,regular=/^(0-3h|3-6h|6-12h|12-24h|24-48h)$/.test(law.horizon),horizon=regular?cohort(leadHours):law.horizon;
 const publicationLeadBin=law.publicationLeadBin?(leadHours<=.25?'5-15m':leadHours<=.5?'15-30m':leadHours<=1?'30-60m':horizon):undefined;
 const earliest=law.earliestTargetObservationAt?Date.parse(law.earliestTargetObservationAt):Date.parse(law.validTime),timely=Number.isFinite(leadHours)&&leadHours>0&&(!law.publicationLeadBin||leadHours>=5/60)&&Number.isFinite(earliest)&&Date.parse(publication.availableAt)<earliest&&Date.parse(publication.receivedAt)>=Date.parse(publication.generatedAt);
 return {...law,leadHours,horizon,...(law.publicationLeadBin?{publicationLeadBin}:{}),availableAt:publication.availableAt,publication,verificationProspective:timely,...(!timely?{verificationBlocker:'confirmed publication reached the target observation window or clock order is invalid'}:{}),...(publication.mode==='replay'?{tradeEligible:false}: {})};
}
async function verifiedPublicationRecords(pending,{root,mode}){
 const groups=new Map(),verified=new Set(),errors=[];
 for(const [id,r] of Object.entries(pending)){const p=r.publication;if(!p||p.mode!==mode)continue;if(!groups.has(p.evidenceId))groups.set(p.evidenceId,[]);groups.get(p.evidenceId).push([id,r]);}
 for(const [evidenceId,rows] of groups)try{
  if(!/^[a-f0-9]{64}$/.test(evidenceId))throw new Error('invalid publication evidence identity');const path=join(root,evidenceId+'.json.gz'),digest=createHash('sha256'),packet=await readStateJson(path,{compressed:true,onBytes:b=>digest.update(b)});
  if(digest.digest('hex')!==evidenceId||packet.kind!=='station-forecast-publication-v1'||packet.mode!==mode)throw new Error('publication evidence integrity or mode mismatch');const metadata=await stat(path);
  for(const [id,r] of rows){const p=r.publication,law=packet.forecasts[String(p.ordinal)];if(!law||p.generatedAt!==packet.generatedAt||r.sourceEvidenceId!==(packet.sourceEvidenceId??undefined)||!r.verificationProspective||p.availableAt!==r.availableAt||mode==='replay'&&p.availableAt!==p.generatedAt||mode==='live'&&(Math.floor(metadata.ctimeMs)>Date.parse(p.receivedAt)||p.availableAt!==p.receivedAt)){errors.push({id,evidenceId,error:'publication receipt, forecast scope or prospective status mismatch'});continue;}
   const {sourceEvidenceId,...actual}=r,expected=confirmedForecast(law,p);if(hash(actual)!==hash(expected)){errors.push({id,evidenceId,error:'pending forecast differs from its immutable published law'});continue;}verified.add(id);
  }
 }catch(e){errors.push({evidenceId,error:e.message});}
 return {verified,errors};
}
'''
replace(anchor,helper+anchor)
replace("export async function updateStationScience(evidence,{root,now=Date.now(),sourceEvidenceId}={}){", "export async function updateStationScience(evidence,{root,now=Date.now(),sourceEvidenceId,publicationRoot=join(root,'evidence'),publicationMode='live'}={}){\n if(!['live','replay'].includes(publicationMode))throw new TypeError('live or explicitly simulated replay publication required');")
replace("  const state=await read(file,{pending:{},history:{},missingOutcomes:0});", "  const state=await read(file,{pending:{},history:{},missingOutcomes:0});state.publicationPending??={};const publicationCheck=await verifiedPublicationRecords(state.publicationPending,{root:publicationRoot,mode:publicationMode});")
replace("  for(const [id,r] of Object.entries({...state.pending,...state.measurementPending})){", "  for(const [id,r] of Object.entries({...state.pending,...state.measurementPending,...state.publicationPending})){\n   const receiptBound=Object.hasOwn(state.publicationPending,id);if(receiptBound&&!publicationCheck.verified.has(id))continue;const pendingCarrier=receiptBound?state.publicationPending:r.verification==='nws-report-cell-v1'?state.measurementPending:state.pending;")
replace("Date.parse(o.at)>Date.parse(r.availableAt)&&Date.parse(o.availableAt)<=now", "(!receiptBound||true)&&Date.parse(o.availableAt)<=now")
# Fix truth selection for receipt-bound forecasts: choose the same report regardless
# of forecast availability, then reject a report that preceded actual publication.
replace("Date.parse(o.at)>Date.parse(r.availableAt)).sort((a,b)=>b.at.localeCompare(a.at))", "(!receiptBound?Date.parse(o.at)>Date.parse(r.availableAt):true)).sort((a,b)=>b.at.localeCompare(a.at))")
replace("Date.parse(o.at)>Date.parse(r.availableAt)).sort((a,b)=>Math.abs", "(!receiptBound?Date.parse(o.at)>Date.parse(r.availableAt):true)).sort((a,b)=>Math.abs")
replace("if(!obs||r.verification==='routine-report-bin'&&", "if(!obs||receiptBound&&Date.parse(obs.at)<=Date.parse(r.availableAt)||r.verification==='routine-report-bin'&&")
replace("delete (r.verification==='nws-report-cell-v1'?state.measurementPending:state.pending)[id];", "delete pendingCarrier[id];")
replace("delete state.measurementPending[id];scored++;", "delete pendingCarrier[id];scored++;")
replace("delete state.pending[id];scored++;", "delete pendingCarrier[id];scored++;")
old="  state.at=new Date(now).toISOString();\n  const forecasts=stationPointForecasts(evidence,{now,parameters:state.parameters,learningState:state});\n  for(const r of forecasts){"
new="  state.at=new Date(now).toISOString();\n  const generationNow=publicationMode==='replay'?now:Date.now(),generated=stationPointForecasts(evidence,{now:generationNow,parameters:state.parameters,learningState:state}),publication=await publishForecastBatch(generated,{root:publicationRoot,now:generationNow,sourceEvidenceId,mode:publicationMode}),forecasts=publication.forecasts;\n  state.lastPublication={...publication,forecasts:undefined,forecastCount:forecasts.length,prospectiveForecastCount:forecasts.filter(r=>r.verificationProspective).length};state.publicationErrors=publicationCheck.errors;\n  for(const r of forecasts){if(!r.verificationProspective)continue;"
replace(old,new)
replace("const pendingCarrier=r.verification==='nws-report-cell-v1'?(state.measurementPending??={}):state.pending;if(pendingCarrier[id])continue;", "const pendingCarrier=state.publicationPending;if(pendingCarrier[id]||state.pending[id]||state.measurementPending[id])continue;")
replace("  state.at=new Date(now).toISOString();await atomic(file,state);", "  state.at=publication.availableAt;await atomic(file,state);")
replace("return {measurementMetrics,at:state.at??null,", "return {lastPublication:state.lastPublication??null,publicationErrors:state.publicationErrors??[],publicationPending:Object.values(state.publicationPending??{}).filter(r=>!station||r.station===station).length,legacyPublicationUnverifiedPending:Object.values({...state.pending,...state.measurementPending}).filter(r=>!station||r.station===station).length,measurementMetrics,at:state.at??null,")
replace("measurementPending:Object.values(state.measurementPending??{}).filter(r=>!station||r.station===station).length,pending:Object.values({...state.pending,...state.measurementPending})", "measurementPending:Object.values({...state.measurementPending,...Object.fromEntries(Object.entries(state.publicationPending??{}).filter(([_,r])=>r.verification==='nws-report-cell-v1'))}).filter(r=>!station||r.station===station).length,pending:Object.values({...state.pending,...state.measurementPending,...state.publicationPending})")
# Restore the legacy cell selector's existing condition while making it fixed for
# receipt-bound records, rather than changing legacy forecast evaluation silently.
after=after.replace("(!receiptBound||true)&&Date.parse(o.availableAt)<=now", "(!receiptBound?Date.parse(o.at)>Date.parse(r.availableAt):true)&&Date.parse(o.availableAt)<=now")
# The complete source replacement pins this final corrected candidate.
changes.append((p,before,after,[{'before':before,'after':after}]))
p=f/'src/weather-engine.mjs';before=p.read_text();old="root:join(root,'station-science'),now:Date.now(),sourceEvidenceId}));}";new="root:join(root,'station-science'),now:Date.now(),sourceEvidenceId,publicationRoot:join(root,'evidence')}));}";assert before.count(old)==1;after=before.replace(old,new);changes.append((p,before,after,[{'before':old,'after':new}]))
p=f/'apps/replay-station-weather-science.mjs';before=p.read_text();old='root:options.output,now:mtime,sourceEvidenceId:name.slice(0,64)';new="root:options.output,now:mtime,sourceEvidenceId:name.slice(0,64),publicationMode:'replay'";assert before.count(old)==1;after=before.replace(old,new);changes.append((p,before,after,[{'before':old,'after':new}]))
clauses=['immutable-law-before-registration','confirmed-publication-clock','fixed-observation-selection','legacy-writer-isolation','explicit-replay-semantics','bounded-json-io','existing-evidence-reader'];files={};edits=[]
for p,before,after,replacements in changes:
 name=str(p.relative_to(repo));sha=hashlib.sha256(before.encode()).hexdigest();files[name]={'state':'present','sha256':sha};(r/(p.stem+'.before.mjs')).write_text(before);(r/(p.stem+'.candidate.mjs')).write_text(after);edits.append({'operation':'edit','path':name,'inputSha256':sha,'replacements':replacements,'clauses':clauses})
(r/'input-inventory.json').write_text(json.dumps({'kind':'source-patchset-input','version':1,'sourceRoot':str(repo),'files':files,'clauses':clauses},indent=2)+'\n');(r/'source-patchset.json').write_text(json.dumps({'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Make scientific forecasts independently retrievable before registration and bind new grades to confirmed publication of the exact law; fixed truth selection and explicit replay retain the distinction between generation, publication and outcome.','changes':edits},indent=2)+'\n')
stage=Path('/tmp/weather-receipt-publication-stage-'+uuid.uuid4().hex);tool=repo/Path('/tmp/weather-source-patchset-tool').read_text().strip();subprocess.run(['python3',str(tool),str(r/'input-inventory.json'),str(r/'source-patchset.json'),str(stage)],check=True);Path('/tmp/weather-receipt-publication-stage').write_text(str(stage));
for p,_,_,_ in changes:subprocess.run(['node','--check',str(stage/p.relative_to(repo))],check=True)
print(json.dumps({'record':str(r),'sourcePaths':len(changes),'canonicalChanged':False}))
