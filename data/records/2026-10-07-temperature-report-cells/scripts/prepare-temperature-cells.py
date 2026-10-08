from pathlib import Path
import json,hashlib
f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=Path(Path('/tmp/weather-temperature-cell-record').read_text());candidate=r/'candidate';candidate.mkdir(exist_ok=True)
obs=(r/'before/station-observations.mjs').read_text()
helper='''export const NWS_REPORT_CELL_VERSION='nws-metar-temperature-cell-v1';
export const NWS_REPORT_CELL_TRUTH='first received validated NWS METAR temperature cell; nearest identified report within 15 minutes';
/** Reporting quantization only: neither instrument error nor a final climate
 * extreme is identified. API numeric formatting/cadence supplies no precision. */
export function temperatureReportCells(pages,{station,start,end,receivedAt}){
 if(!Array.isArray(pages)||pages.length>8||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(Date.parse(receivedAt)))throw new TypeError('bounded observation pages, interval and receipt required');
 const witnesses=[],groups=new Map();let outsideWindowRows=0;
 for(const page of pages)for(const feature of page.packet.features??[]){
  const p=feature?.properties??{},q=p.temperature,epoch=Date.parse(p.timestamp),receipt=Date.parse(page.receivedAt),raw=typeof p.rawMessage==='string'?p.rawMessage.trim():'',featureStation=typeof p.station==='string'?p.station.split('/').at(-1):null;
  if(Number.isFinite(epoch)&&(epoch<start||epoch>=end)){outsideWindowRows++;continue;}
  const w={featureId:feature.id??p['@id']??null,pageSha256:page.sha256,source:page.url,availableAt:page.receivedAt,station,at:Number.isFinite(epoch)?new Date(epoch).toISOString():null,rawTemperature:q??null,rawMessage:raw,status:'precision-unidentified',cell:null};
  witnesses.push(w);
  if(!Number.isFinite(epoch)||epoch<start||epoch>=end){w.status='invalid-observation-time';continue;}
  if(!Number.isFinite(receipt)||receipt>Date.parse(receivedAt)||epoch>receipt){w.status='noncausal-report';continue;}
  if(featureStation&&featureStation!==station){w.status='station-mismatch';continue;}
  if(!['V','qc:V'].includes(q?.qualityControl)||!Number.isFinite(q?.value)||!['wmoUnit:degC','wmoUnit:degF'].includes(q?.unitCode)){w.status='missing-or-untrusted';continue;}
  if(!raw)continue;
  const header=/^(?:(?:METAR|SPECI)\\s+)?([A-Z0-9]{4})\\s+(\\d{2})(\\d{2})(\\d{2})Z\\b/.exec(raw),at=new Date(epoch);
  if(!header||header[1]!==station||Number(header[2])!==at.getUTCDate()||Number(header[3])!==at.getUTCHours()||Number(header[4])!==at.getUTCMinutes()||at.getUTCSeconds()!==0){w.status='report-header-mismatch';continue;}
  const [body,remarks='']=raw.split(/\\bRMK\\b/,2),whole=/\\b(M?\\d{2})\\/(?:M?\\d{2}|\\/\\/)?(?=\\s|$)/.exec(body),tenths=[...remarks.matchAll(/(?:^|\\s)T([01])(\\d{3})(?:[01]\\d{3}|\\/\\/\\/\\/)(?=\\s|$)/g)];
  const encoded=[];if(whole){const value=Number(whole[1].replace('M',''))*(whole[1].startsWith('M')?-1:1);encoded.push({kind:'whole-Celsius-body',valueC:value,resolutionC:1,lowC:value-.5,highC:value+.5});}
  for(const match of tenths){const value=Number(match[2])/10*(match[1]==='1'?-1:1);encoded.push({kind:'tenths-Celsius-remark',valueC:value,resolutionC:.1,lowC:value-.05,highC:value+.05});}
  if(!encoded.length)continue;
  const lowC=Math.max(...encoded.map(c=>c.lowC)),highC=Math.min(...encoded.map(c=>c.highC)),apiC=q.unitCode==='wmoUnit:degF'?(q.value-32)*5/9:q.value,apiEnvelope=whole?encoded[0]:{lowC,highC};
  const incompatible=lowC>highC||lowC*9/5+32< -150||highC*9/5+32>180||(apiEnvelope&&(apiC<apiEnvelope.lowC-1e-8||apiC>apiEnvelope.highC+1e-8));
  w.encodings=encoded;w.decodedApiF=q.unitCode==='wmoUnit:degF'?q.value:q.value*9/5+32;
  if(incompatible){w.status='contradictory-encoding';}
  else{w.status='identified';w.cell={lowF:lowC*9/5+32,highF:highC*9/5+32,resolutionBasis:encoded.some(c=>c.resolutionC===.1)?'tenths-Celsius-remark':'whole-Celsius-body'};}
  const group=groups.get(w.at)??[];group.push(w);groups.set(w.at,group);
 }
 const readings=[];
 for(const [at,rows] of groups){
  const cells=rows.filter(w=>w.cell),lowF=cells.length?Math.max(...cells.map(w=>w.cell.lowF)):null,highF=cells.length?Math.min(...cells.map(w=>w.cell.highF)):null,conflicted=rows.some(w=>w.status==='contradictory-encoding')||lowF===null||lowF>highF;
  readings.push({at,status:conflicted?'conflicted':'identified',lowF:conflicted?null:lowF,highF:conflicted?null:highF,temperatureF:conflicted?null:(lowF+highF)/2,availableAt:rows.reduce((a,w)=>a<w.availableAt?w.availableAt:a,''),source:rows[0].source,measurementOperator:NWS_REPORT_CELL_VERSION,witnesses:rows});
 }
 readings.sort((a,b)=>a.at.localeCompare(b.at));
 return {operator:NWS_REPORT_CELL_VERSION,truth:NWS_REPORT_CELL_TRUTH,receivedAt,outsideWindowRows,witnesses,readings,identified:readings.filter(r=>r.status==='identified').length,conflicted:readings.filter(r=>r.status==='conflicted').length,unidentified:witnesses.filter(w=>w.status==='precision-unidentified').length,scope:'closed inverse-rounding envelopes conditional on validated raw METAR encoding; no cadence-derived precision, instrument-error bound, independent-trial count or settlement certification'};
}

'''
obs=obs.replace('/** The UTC instant',helper+'/** The UTC instant',1)
obs=obs.replace('const trace=[...readings.values()]',"const temperatureMetrology=temperatureReportCells(pages,{station,start:from.getTime(),end:from.getTime()+86400000,receivedAt});\n  const trace=[...readings.values()]",1)
obs=obs.replace('source:url.href,precipitation,rawPages}', 'source:url.href,precipitation,rawPages,temperatureMetrology}')
ensemble=(r/'before/weather-ensemble.mjs').read_text()
old="const points=components(r).flatMap(c=>c.empirical?empiricalPoints(c).map(x=>({x,w:c.weight/c.empirical.pointsF.length})):nodes.map(z=>({x:c.meanF+c.scaleF*z,w:c.weight/nodes.length}))).sort((a,b)=>a.x-b.x);"
assert old in ensemble
ensemble=ensemble.replace('/** 41 nodes per component',"function scoringPoints(r){return components(r).flatMap(c=>c.empirical?empiricalPoints(c).map(x=>({x,w:c.weight/c.empirical.pointsF.length})):nodes.map(z=>({x:c.meanF+c.scaleF*z,w:c.weight/nodes.length}))).sort((a,b)=>a.x-b.x);}\n/** 41 nodes per component",1).replace(old,'const points=scoringPoints(r);',1)
interval='''/** Exact piecewise-linear extrema for the law used by the existing CRPS
 * scorer: exact empirical atoms, 41-node approximation for Student-t components.
 * Paired gains use ONE common report cell, rather than independent labels. */
export function temperatureDistributionCellScores(r,{lowF,highF},{comparators=[]}={}){
 if(!Number.isFinite(lowF)||!Number.isFinite(highF)||lowF>highF||!Array.isArray(comparators)||comparators.length>16)throw new TypeError('finite ordered reporting cell and bounded comparators required');
 const summarize=law=>{
  const points=scoringPoints(law),weights=[0],moments=[0];let pairHalf=0;
  for(const p of points){if(!Number.isFinite(p.x)||!Number.isFinite(p.w)||p.w<0)throw new TypeError('finite nonnegative scoring law required');const w=weights.at(-1),m=moments.at(-1);pairHalf+=p.w*(p.x*w-m);weights.push(w+p.w);moments.push(m+p.w*p.x);}
  const total=weights.at(-1),moment=moments.at(-1);if(Math.abs(total-1)>1e-8)throw new TypeError('normalized scoring law required');
  const score=y=>{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].x<=y)lo=mid+1;else hi=mid;}return Math.max(0,y*weights[lo]-moments[lo]+moment-moments[lo]-y*(total-weights[lo])-pairHalf);};
  const knots=points.filter(p=>p.x>lowF&&p.x<highF).map(p=>p.x);return {score,knots};
 };
 const pool=summarize(r),values=[lowF,highF,...pool.knots].map(pool.score),gains=comparators.map(c=>{const component=summarize({...c,weight:1}),knots=[lowF,highF,...pool.knots,...component.knots],values=knots.map(y=>component.score(y)-pool.score(y));return {model:c.model,family:c.family??null,lowF:Math.min(...values),highF:Math.max(...values)};});
 return {lowF:Math.min(...values),highF:Math.max(...values),gains,measurementCell:{lowF,highF},method:'all piecewise-linear knots in common report cell; exact empirical law / existing 41-node Student-t CRPS approximation'};
}

'''
ensemble=ensemble.replace('export function temperatureDiagnostics',interval+'export function temperatureDiagnostics',1)
family=(r/'before/weather-family-learning.mjs').read_text()
family=family.replace("import {makeTemperaturePool}","import {NWS_REPORT_CELL_VERSION,NWS_REPORT_CELL_TRUTH} from './station-observations.mjs';\nimport {makeTemperaturePool}",1)
family=family.replace('/** Uniform initialization',"export const CELL_FAMILY_LEARNING_PROTOCOL=Object.freeze({...FAMILY_LEARNING_PROTOCOL,id:'paired-family-cell-ewa-v1'});\n/** Uniform initialization",1)
family=family.replace('{now=Date.now()}={})','{now=Date.now(),reportedCells=false}={})',1)
family=family.replace(' const components=base.mixture?.components;'," if(typeof reportedCells!=='boolean')throw new TypeError('reportedCells must be boolean');\n const protocol=reportedCells?CELL_FAMILY_LEARNING_PROTOCOL:FAMILY_LEARNING_PROTOCOL,gainField=reportedCells?'gainUpperSumF':'gainSum';\n if(reportedCells&&(!Number.isFinite(Date.parse(base.validTime))||Date.parse(base.validTime)-15*60000<=now))return null;\n const components=base.mixture?.components;",1)
family=family.replace('FAMILY_LEARNING_PROTOCOL.windowDays','protocol.windowDays').replace('state.comparisons??{}',"(reportedCells?state.measurementComparisons:state.comparisons)??{}").replace("row.truth!==(base.truth??'NWS station observations')","row.truth!==(reportedCells?NWS_REPORT_CELL_TRUTH:(base.truth??'NWS station observations'))||(reportedCells&&row.measurementOperator!==NWS_REPORT_CELL_VERSION)").replace('!Number.isFinite(row.gainSum)','!Number.isFinite(row[gainField])').replace('day.get(f).gainSum/day.get(f).n','day.get(f)[gainField]/day.get(f).n').replace('FAMILY_LEARNING_PROTOCOL.priorDays','protocol.priorDays').replace('FAMILY_LEARNING_PROTOCOL.etaPerF','protocol.etaPerF').replace('FAMILY_LEARNING_PROTOCOL.uniformShare','protocol.uniformShare')
family=family.replace('gainSumF:r.gainSum,',"...(reportedCells?{gainLowSumF:r.gainLowSumF,gainUpperSumF:r.gainUpperSumF,measurementOperator:r.measurementOperator}:{gainSumF:r.gainSum}),")
family=family.replace("model:base.model+'/paired-family-ewa-v1'", "model:base.model+'/'+protocol.id,...(reportedCells?{verification:'nws-report-cell-v1',truth:NWS_REPORT_CELL_TRUTH,earliestTargetObservationAt:new Date(Date.parse(base.validTime)-15*60000).toISOString()}: {})")
family=family.replace('learning:{...FAMILY_LEARNING_PROTOCOL,weights','learning:{...protocol,...(reportedCells?{lossBasis:\'upper paired component excess CRPS over one common reported-temperature cell\',measurementOperator:NWS_REPORT_CELL_VERSION}:{}),weights')
science=(r/'before/station-weather-science.mjs').read_text()
science=science.replace("import {adaptiveTemperaturePool}","import {NWS_REPORT_CELL_VERSION,NWS_REPORT_CELL_TRUTH} from './station-observations.mjs';\nimport {adaptiveTemperaturePool}",1).replace('temperatureDistributionCrps}', 'temperatureDistributionCrps,temperatureDistributionCellScores}',1)
science=science.replace("if(day.verification==='routine-report-bin')continue;", "if(['routine-report-bin','nws-report-cell-v1'].includes(day.verification))continue;",1)
science=science.replace('return {at:state.at??null,truth:',"const measurementMetrics=Object.values(state.measurementHistory??{}).filter(r=>!station||r.station===station).map(r=>({...r,crpsCellLowF:r.crpsLowSumF/r.n,crpsCellHighF:r.crpsHighSumF/r.n}));\n  return {measurementMetrics,at:state.at??null,truth:",1)
science=science.replace(' out.push(...adaptive);'," const metrologic=out.filter(r=>/family-pool/.test(r.model)&&!r.model.includes('/station-postprocess-v1')&&!r.model.includes('/paired-family-')&&!r.verification).map(r=>adaptiveTemperaturePool(r,learningState,{now,reportedCells:true})).filter(Boolean);\n out.push(...adaptive,...metrologic);",1)
science=science.replace(' const traces=new Map();'," const metrology=new Map();for(const e of Object.values(evidence.observations??{}))for(const r of e.temperatureMetrology?.readings??[]){if(!metrology.has(e.station))metrology.set(e.station,[]);metrology.get(e.station).push(r);}\n const traces=new Map();",1)
science=science.replace('const obs=r.verification',"const cellObservation=r.verification==='nws-report-cell-v1'?(metrology.get(r.station)??[]).filter(o=>Math.abs(Date.parse(o.at)-valid)<=15*60000&&Date.parse(o.at)<=now&&Date.parse(o.at)>Date.parse(r.availableAt)&&Date.parse(o.availableAt)<=now&&Date.parse(o.availableAt)>=Date.parse(o.at)&&o.measurementOperator===NWS_REPORT_CELL_VERSION).sort((a,b)=>Math.abs(Date.parse(a.at)-valid)-Math.abs(Date.parse(b.at)-valid)||b.at.localeCompare(a.at))[0]:null;\n   const obs=r.verification==='nws-report-cell-v1'?(cellObservation?.status==='identified'?cellObservation:null):r.verification",1)
needle='  const error=obs.temperatureF-r.meanF,k=key(r),dk=k+\'/\'+r.date;'
block='''   if(r.verification==='nws-report-cell-v1'){
    const baseline=r.comparators?.find(c=>c.model===r.model.split('/paired-family-cell-ewa-v1')[0]);
    const cellScores=temperatureDistributionCellScores(r,obs),k=key(r),dk=k+'/'+r.date;
    state.measurementHistory??={};const h=state.measurementHistory[dk]??={key:k,station:r.station,model:r.model,horizon:r.horizon,publicationLeadBin:r.publicationLeadBin??null,date:r.date,truth:NWS_REPORT_CELL_TRUTH,measurementOperator:NWS_REPORT_CELL_VERSION,n:0,crpsLowSumF:0,crpsHighSumF:0};h.n++;h.crpsLowSumF+=cellScores.lowF;h.crpsHighSumF+=cellScores.highF;h.scoreAvailableAt=new Date(now).toISOString();h.sourceEvidenceId=sourceEvidenceId;
    if(baseline){
     const scores=temperatureDistributionCellScores(baseline,obs,{comparators:baseline.mixture.components});state.measurementComparisons??={};
     for(const gain of scores.gains){const pairKey=hash({station:r.station,pool:baseline.model,component:gain.model,horizon:r.horizon,composition:baseline.composition,configurationVersion:baseline.details?.configVersion??null,truth:NWS_REPORT_CELL_TRUTH,measurementOperator:NWS_REPORT_CELL_VERSION}),dayKey=pairKey+'/'+r.date;
      const paired=state.measurementComparisons[dayKey]??={key:pairKey,station:r.station,pool:baseline.model,component:gain.model,family:gain.family,horizon:r.horizon,composition:baseline.composition,configurationVersion:baseline.details?.configVersion??null,truth:NWS_REPORT_CELL_TRUTH,measurementOperator:NWS_REPORT_CELL_VERSION,date:r.date,n:0,gainLowSumF:0,gainUpperSumF:0};paired.n++;paired.gainLowSumF+=gain.lowF;paired.gainUpperSumF+=gain.highF;paired.scoreAvailableAt=new Date(now).toISOString();paired.sourceEvidenceId=sourceEvidenceId;
     }
    }
    outcomes.push({id,forecast:r,observation:obs,cellScores,sourceEvidenceId});delete state.pending[id];scored++;continue;
   }
'''
assert needle in science;science=science.replace(needle,block+needle,1)
science=science.replace(' for(const [k,d] of Object.entries(state.comparisons))'," for(const carrier of ['measurementHistory','measurementComparisons'])for(const [k,d] of Object.entries(state[carrier]??{}))if(d.date<cutoff)delete state[carrier][k];\n for(const [k,d] of Object.entries(state.comparisons))",1)
science=science.replace(" const traces=new Map();", " state.measurementPending??={};for(const [id,r] of Object.entries(state.pending))if(r.verification==='nws-report-cell-v1'){state.measurementPending[id]??=r;delete state.pending[id];}\n const traces=new Map();",1)
science=science.replace('Object.entries(state.pending)){', 'Object.entries({...state.pending,...state.measurementPending})){',1)
science=science.replace('delete state.pending[id];state.missingOutcomes++', "delete (r.verification==='nws-report-cell-v1'?state.measurementPending:state.pending)[id];state.missingOutcomes++",1)
science=science.replace('delete state.pending[id];scored++;continue;', 'delete state.measurementPending[id];scored++;continue;',1)
science=science.replace('if(state.pending[id])continue;state.pending[id]={...r,sourceEvidenceId};forecasted++;', "const pendingCarrier=r.verification==='nws-report-cell-v1'?(state.measurementPending??={}):state.pending;if(pendingCarrier[id])continue;pendingCarrier[id]={...r,sourceEvidenceId};forecasted++;",1)
science=science.replace('pending:Object.values(state.pending??{}).filter', 'measurementPending:Object.values(state.measurementPending??{}).filter(r=>!station||r.station===station).length,pending:Object.values({...state.pending,...state.measurementPending}).filter',1)
doc=(r/'before/README-weather.md').read_text()+'''\n\nReported-temperature metrology supplements the original point-temperature lane. `observedExtremes.temperatureMetrology` retains validated raw METAR whole-Celsius and tenths-Celsius inverse-rounding cells, their page hashes, actual receipts and conflicting witnesses. Numeric API formatting or observation cadence alone never establishes reporting precision; those rows remain unidentified. Cells cover reporting quantization, not instrument error or final climate extremes. The `paired-family-cell-ewa-v1` station experiment requires publication before the earliest possible target report (15 minutes before the target hour). It scores CRPS and paired component excess-loss ranges over the same source-supported cell, using exact empirical atoms and the existing 41-node Student-t scoring approximation. Prospective cell comparisons feed a separate past-only family learner using upper paired excess loss, equal date contributions, the existing fixed prior/rate/window and uniform share; it does not reuse point-label fits. `weather_station_skill` exposes `measurementMetrics`; full cell outcomes and model inputs remain in `weather_evidence`. Unknown or contradictory cells cannot supply a training label. The outcome uses the first received eligible report set; later arrivals or revisions remain source evidence and never rewrite that frozen outcome. Report-cell targets use `measurementPending` within the existing locked state record; older point-only consumers preserve that map but never interpret its targets. Known report-cell targets from the earlier candidate are migrated from `pending` under the same lock. Original forecasts, point scores and venue settlement remain separate. This is an uncalibrated experiment, with no regret or profitability claim. Primary measurement descriptions: [NWS Chicago](https://www.weather.gov/lot/weather_observations_faq), [NWS Los Angeles](https://www.weather.gov/lox/asostemperature).\n'''
outputs={'src/station-observations.mjs':obs,'src/weather-ensemble.mjs':ensemble,'src/weather-family-learning.mjs':family,'src/station-weather-science.mjs':science,'README-weather.md':doc};files={};changes=[]
for name,text in outputs.items():
 p=f/name;old=(r/'before'/p.name).read_text();assert old!=text;rel=str(p.relative_to(Path.cwd()));sha=hashlib.sha256(old.encode()).hexdigest();dest=candidate/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(text);files[rel]={'state':'present','sha256':sha};changes.append({'operation':'edit','path':rel,'inputSha256':sha,'replacements':[{'before':old,'after':text}],'clauses':['measurement-witnesses','cell-scoring','past-only-learning','existing-consumers']})
(r/'input-inventory.json').write_text(json.dumps({'kind':'source-patchset-input','version':1,'sourceRoot':str(Path.cwd()),'files':files,'clauses':['measurement-witnesses','cell-scoring','past-only-learning','existing-consumers']},indent=2)+'\n')
(r/'source-patchset.json').write_text(json.dumps({'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Carry source-supported reported-temperature uncertainty through prospective forecast-family scoring and adaptation.','changes':changes},indent=2)+'\n');print(json.dumps({'candidatePaths':len(outputs)}))
