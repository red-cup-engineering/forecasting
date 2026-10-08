from pathlib import Path
import json,hashlib,uuid,subprocess
f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());repo=Path('/home/emsenn/info');r=f/'data/records/2026-10-07-progressive-weather-publication';r.mkdir(parents=True,exist_ok=True);(r/'scripts').mkdir(exist_ok=True);Path('/tmp/weather-progressive-record').write_text(str(r))
p=f/'src/weather-evidence.mjs';before=p.read_text();after=before.replace('now=Date.now(),fetchImpl=fetch,marketCollection=false}={}) {','now=Date.now(),fetchImpl=fetch,marketCollection=false,onEvidence}={}) {',1)
old='  const observations={},local={},stationMetadata={};'
new='''  const observations={},local={},stationMetadata={},relational={regions:[]};let ecmwfEnsemble=null;
  if(onEvidence!==undefined&&typeof onEvidence!=='function')throw new TypeError('onEvidence must be a receiving function');
  const sourceNames=['NWS-stations','NBM','NBM-NBH','NBM-QMD','LAMP','climate-reports'],finishedSources=[],finishedStations=[];
  const regions=Object.entries(RELATIONAL_REGIONS).filter(([_,peers])=>stations.some(station=>peers.includes(station.slice(1))));
  const plannedSources=[...sourceNames,...regions.map(([region])=>'relational:'+region),'ECMWF-AIFS-ENS'];
  const snapshot=complete=>({at:new Date(now).toISOString(),stations:normalized,guidance,hourlyGuidance,quantiles,lamp,settlement,local,observations,relational,ecmwfEnsemble,errors,
    acquisition:{complete,requestedStations:stations.length,finishedStations:[...finishedStations],finishedSources:[...finishedSources],pendingSources:plannedSources.filter(s=>!finishedSources.includes(s)),scope:'finished means the acquisition attempt ended; source errors and missing evidence remain explicit'}});
  let publication=null,timer=null,dirty=false,closed=false,lastAttempt=-Infinity;
  const drain=()=>{
    if(closed||!onEvidence||publication||!dirty)return;
    const wait=60000-(Date.now()-lastAttempt);
    if(wait>0){if(!timer){timer=setTimeout(()=>{timer=null;drain();},wait);timer.unref();}return;}
    dirty=false;const frozen=structuredClone(snapshot(false));lastAttempt=Date.now();
    publication=Promise.resolve().then(()=>onEvidence(frozen)).then(published=>{if(published===false)lastAttempt=-Infinity;})
      .catch(e=>errors.push({source:'incremental-publication',error:e.message})).finally(()=>{publication=null;drain();});
  };
  const emit=()=>{dirty=true;drain();};
  emit();'''
assert after.count(old)==1;after=after.replace(old,new)
old='''    }
  });
  },
    async()=>{try{guidance='''
new='''    }
    finishedStations.push(station);emit();
  });
  },
    async()=>{try{guidance='''
assert after.count(old)==1;after=after.replace(old,new)
old='''  await mapLimit(collectors,3,collect=>collect());
  const relational={regions:[]};
  for(const [region,peers] of Object.entries(RELATIONAL_REGIONS))if(stations.some(station=>peers.includes(station.slice(1))))try{relational.regions.push(await collectRelationalWeatherNowcast({region,cacheDir:cacheDir?join(cacheDir,'relational'):undefined,now:Date.now(),fetchImpl}));}catch(e){errors.push({source:'relational-nowcast',region,error:e.message});}
  let ecmwfEnsemble=null;'''
new='''  try{await mapLimit(collectors,3,async(collect,i)=>{await collect();finishedSources.push(sourceNames[i]);emit();});
  for(const [region] of regions){
    try{relational.regions.push(await collectRelationalWeatherNowcast({region,cacheDir:cacheDir?join(cacheDir,'relational'):undefined,now:Date.now(),fetchImpl}));}catch(e){errors.push({source:'relational-nowcast',region,error:e.message});}
    finishedSources.push('relational:'+region);emit();
  }'''
assert after.count(old)==1;after=after.replace(old,new)
old='''  return {at:new Date(now).toISOString(),stations:normalized,guidance,hourlyGuidance,quantiles,lamp,settlement,local,observations,relational,ecmwfEnsemble,errors};'''
new='''  finishedSources.push('ECMWF-AIFS-ENS');
  return snapshot(true);
  }finally{closed=true;if(timer)clearTimeout(timer);if(publication)await publication;}'''
assert after.count(old)==1;after=after.replace(old,new)
old='''  const evidence=requests.size?await collectStationWeatherEvidence([...requests.values()],{...options,now,marketCollection:true}):{at:new Date(now).toISOString(),stations:[],guidance:null,quantiles:null,settlement:null,local:{},observations:{},errors:[]};'''
new='''  const receive=options.onEvidence?packet=>options.onEvidence({...packet,indices:structuredClone(indexEvidence.cities),errors:[...packet.errors,...indexEvidence.errors]}):undefined;
  const evidence=requests.size?await collectStationWeatherEvidence([...requests.values()],{...options,now,marketCollection:true,onEvidence:receive}):{at:new Date(now).toISOString(),stations:[],guidance:null,quantiles:null,settlement:null,local:{},observations:{},errors:[],acquisition:{complete:true,requestedStations:0,finishedStations:[],finishedSources:[],pendingSources:[]}};'''
assert after.count(old)==1;after=after.replace(old,new)
changes=[(p,before,after)]
p=f/'src/weather-engine.mjs';before=p.read_text();after=before
old='''    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now:Date.now(),fetchImpl});
    const evidenceId=await archiveWeatherEvidence(evidence,root);'''
new='''    const publish=async evidence=>{
    const evidenceId=await archiveWeatherEvidence(evidence,root);'''
assert after.count(old)==1;after=after.replace(old,new)
old="    const result={science,at:new Date().toISOString(),collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,series:universe.series,"
new="    const result={science,at:new Date().toISOString(),collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,evidenceComplete:evidence.acquisition?.complete??true,acquisition:evidence.acquisition,series:universe.series,"
assert after.count(old)==1;after=after.replace(old,new)
old="    await atomic(join(root,'latest.json'),result);return result;\n  });\n}\n\n/** Market participation"
new="""    await atomic(join(root,'latest.json'),result);return result;
    };
    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now:Date.now(),fetchImpl,onEvidence:async packet=>{
      // A frozen, useful projection can reach existing consumers while slower
      // providers continue. Empty projections leave the prior publication intact.
      if(!universe.markets.some(c=>weatherEstimates(c,packet,Date.now()).length))return false;
      await publish(packet);return true;
    }});
    return publish(evidence);
  });
}

/** Market participation"""
assert after.count(old)==1;after=after.replace(old,new)
changes.append((p,before,after));clauses=['frozen-receiving','bounded-publication','full-acquisition','honest-completeness','existing-admission']
files={};edits=[]
for p,before,after in changes:
 assert before!=after
 name=str(p.relative_to(repo));sha=hashlib.sha256(before.encode()).hexdigest();files[name]={'state':'present','sha256':sha};(r/(p.stem+'.before.mjs')).write_text(before);(r/(p.stem+'.candidate.mjs')).write_text(after)
 edits.append({'operation':'edit','path':name,'inputSha256':sha,'replacements':[{'before':before,'after':after}],'clauses':clauses})
(r/'input-inventory.json').write_text(json.dumps({'kind':'source-patchset-input','version':1,'sourceRoot':str(repo),'files':files,'clauses':clauses},indent=2)+'\n');(r/'source-patchset.json').write_text(json.dumps({'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Publish completed evidence during bounded full acquisition instead of withholding every forecast behind the full-provider barrier.','changes':edits},indent=2)+'\n');(r/'receiving-conditions.json').write_text(json.dumps({'effect':'A slow source does not prevent a useful frozen forecast publication through existing readers.','clauses':clauses,'required':['Snapshots never share mutable acquisition objects.','Publication callbacks are serialized and bounded to one attempt per minute; zero-model projections do not consume the publication interval.','Every previously requested station, date and provider remains acquired.','The final projection preserves original source/model values apart from added acquisition metadata.','Partial and full completeness are explicit, independent of universe completeness.','Pending forecasts, rule changes, fresh quote receipts, scoring and trade admission use the existing path.','Native receiving must show a useful latest publication while acquisition is still active.'],'ordersAllowed':False},indent=2)+'\n')
stage=Path('/tmp/weather-progressive-stage-'+uuid.uuid4().hex);tool=repo/Path('/tmp/weather-source-patchset-tool').read_text().strip();subprocess.run(['python3',str(tool),str(r/'input-inventory.json'),str(r/'source-patchset.json'),str(stage)],check=True)
for p,_,_ in changes:subprocess.run(['node','--check',str(stage/p.relative_to(repo))],check=True)
Path('/tmp/weather-progressive-stage').write_text(str(stage));print(json.dumps({'record':str(r),'stagedPaths':len(changes)}))
