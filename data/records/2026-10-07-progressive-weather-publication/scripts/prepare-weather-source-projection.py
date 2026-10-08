from pathlib import Path
import hashlib,json,subprocess
repo=Path('/home/emsenn/info');f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=Path(Path('/tmp/weather-progressive-record').read_text().strip());p=f/'src/weather-engine.mjs';before=p.read_text();after=before
changes=[]
def replace(old,new):
 global after
 assert after.count(old)==1,old[:100]
 after=after.replace(old,new);changes.append({'before':old,'after':new})
replace('async function archiveWeatherEvidence(evidence,root) {','async function archiveWeatherEvidence(evidence,root,{sourceProjection=false}={}) {')
replace("  try{evidence.science=await locked(join(root,'station-science'),()=>updateStationScience", "  if(sourceProjection)evidence.science={status:'source projection; scientific outcome scoring and refinement await complete acquisition',parameters:{},forecasts:[],outcomes:[]};\n  else try{evidence.science=await locked(join(root,'station-science'),()=>updateStationScience")
replace('    const scoring=await scorePending(root,client,now);',"    let scoring={settled:0,pending:null,errors:[],grades:await read(join(root,'grades.json'),{}),status:'venue outcome scoring awaits completed acquisition'};")
replace('    const publish=async evidence=>{\n    const evidenceId=await archiveWeatherEvidence(evidence,root);',"    const publish=async (evidence,{sourceProjection=false}={})=>{\n    const evidenceId=await archiveWeatherEvidence(evidence,root,{sourceProjection});\n    if(!sourceProjection)scoring=await scorePending(root,client,Date.now());")
replace('    for(let i=0;i<quoted.length;i+=100){','    for(let i=0;!sourceProjection&&i<quoted.length;i+=100){')
replace("    const ex=await experiments(root,contracts,decisionNow),pending=await read(join(root,'pending.json'),{}),rows=[],opportunities=[];","    const ex=sourceProjection?new Map():await experiments(root,contracts,decisionNow),pending=await read(join(root,'pending.json'),{}),rows=[],opportunities=[];")
replace("      const s=stage(c,decisionNow)+(evidence.acquisition?.complete===false?'/during-acquisition-v1':''),models=weatherEstimates(c,evidence,decisionNow);","      const s=stage(c,decisionNow)+(sourceProjection?'/source-projection-v1':evidence.acquisition?.complete===false?'/during-acquisition-v1':''),models=weatherEstimates(c,evidence,decisionNow);")
replace("      if(models.length&&midpoint!==null&&c.status==='active'&&Date.parse(c.close_time)>Date.now()){","      if(models.length&&(sourceProjection||midpoint!==null)&&c.status==='active'&&Date.parse(c.close_time)>Date.now()){")
replace("      try{opportunities.push(...await quoteWeatherContract(c,modelBands,evidence,client));}catch(e){row.bookError=e.message;}","      if(!sourceProjection)try{opportunities.push(...await quoteWeatherContract(c,modelBands,evidence,client));}catch(e){row.bookError=e.message;}")
replace("    const result={science,at:new Date().toISOString(),collectionStartedAt:","    const result={science,...(sourceProjection?{forecastLane:'source-projection-v1'}:{}),at:new Date().toISOString(),collectionStartedAt:")
replace('      return Boolean(await publish(packet));','      return Boolean(await publish(packet,{sourceProjection:true}));')
# A newly listed hourly market must preserve the publication regime that produced its law.
replace("const b=c.binding,stageValue=stage(c,Date.parse(receivedAt)),bands=", "const b=c.binding,stageValue=stage(c,Date.parse(receivedAt))+(state.forecastLane==='source-projection-v1'?'/source-projection-v1':state.evidenceComplete===false?'/during-acquisition-v1':''),bands=")
clauses=['source-law-before-learning','market-capture-separate','complete-refinement-preserved','independent-prospective-cohort','all-markets-retained'];name=str(p.relative_to(repo));sha=hashlib.sha256(before.encode()).hexdigest()
(r/'source-projection.before.mjs').write_text(before);(r/'source-projection.candidate.mjs').write_text(after)
(r/'projection-input-inventory.json').write_text(json.dumps({'kind':'source-patchset-input','version':1,'sourceRoot':str(repo),'files':{name:{'state':'present','sha256':sha}},'clauses':clauses},indent=2)+'\n')
(r/'projection-source-patchset.json').write_text(json.dumps({'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Publish source-derived physical probabilities independently of scientific outcome fitting and venue prices; preserve the completed refined publication and give direct projections their own prospective cohort.','changes':[{'operation':'edit','path':name,'inputSha256':sha,'replacements':changes,'clauses':clauses}]},indent=2)+'\n')
stage=Path(Path('/tmp/weather-progressive-stage').read_text().strip());(stage/name).write_text(after);subprocess.run(['node','--check',str(stage/name)],check=True)
print(json.dumps({'sourcePaths':1,'pinnedInput':sha,'candidate':hashlib.sha256(after.encode()).hexdigest(),'canonicalChanged':False}))
