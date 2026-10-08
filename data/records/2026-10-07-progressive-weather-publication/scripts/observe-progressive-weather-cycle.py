from pathlib import Path
import subprocess,time,json,datetime,hashlib,gzip
home=Path.home();out=home/'.local/state/561-group/weather-progressive-publication';out.mkdir(parents=True,exist_ok=True);root=home/'.local/state/561-group/settlements/kalshi-services-section/weather';pointer=home/'.local/share/561-group/weather-research/current';expected='f854c2ec3a51e5b33ece5aec0384d80dcb86c77abbf8c1fd46a715ae460d246a';unit='weather-561-group.service'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state():
 raw=subprocess.check_output(['systemctl','--user','show',unit,'-p','MainPID','-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp','-p','CPUUsageNSec','-p','MemoryPeak','-p','MemorySwapPeak'],text=True)
 return dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
def log(v):print(json.dumps(v),flush=True)
def publication():
 p=root/'latest.json'
 if not p.exists():return None,None
 raw=p.read_bytes();d=json.loads(raw)
 return {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'at':d.get('at'),'collectionStartedAt':d.get('collectionStartedAt'),'complete':d.get('complete'),'evidenceComplete':d.get('evidenceComplete'),'acquisition':d.get('acquisition'),'marketCount':d.get('marketCount'),'modelled':d.get('modelled'),'evidenceIds':sorted({r['evidenceId'] for r in d.get('forecasts',[]) if r.get('evidenceId')}),'families':d.get('families'),'errors':d.get('errors'),'science':d.get('science'),'orderEffect':d.get('orderEffect')},raw
config=subprocess.check_output(['systemctl','--user','cat',unit]);baseline,_=publication();log({'at':stamp(),'existingWorker':state(),'baselineAt':baseline['at']})
deadline=time.monotonic()+180
while state()['MainPID']!='0':
 if time.monotonic()>deadline:raise RuntimeError('existing worker remains active; no new cycle started')
 time.sleep(30);log({'at':stamp(),'waitingForExistingWorker':state()})
oldTerminal=state();assert pointer.resolve().name==expected
subprocess.run(['systemctl','--user','start','--no-block',unit],check=True);started=stamp();deadline=time.monotonic()+620;pid=None;samples=[];pubs=[];seen=baseline['sha256'];early=None
while True:
 s=state();sample={'at':stamp(),**s};samples.append(sample);log({'at':stamp(),'receivingWorker':s})
 if s['MainPID']!='0':pid=s['MainPID']
 p,raw=publication()
 if p and p['sha256']!=seen:
  seen=p['sha256'];pubs.append(p);log({'at':stamp(),'newPublicationAt':p['at'],'evidenceComplete':p['evidenceComplete'],'modelled':p['modelled'],'marketCount':p['marketCount'],'acquisition':p['acquisition']})
  if early is None and s['MainPID']!='0' and p['evidenceComplete'] is False and p['modelled']>0 and datetime.datetime.fromisoformat(p['collectionStartedAt'].replace('Z','+00:00'))>=datetime.datetime.fromisoformat(started):
   early={'at':stamp(),'runtime':str(pointer.resolve()),'liveWorker':sample,'publication':p,'nativeWorkerAliveAtReceiving':True,'ordersPlaced':0};(out/'early-publication.json').write_text(json.dumps(early,indent=2)+'\n');(out/'early-latest.json.gz').write_bytes(gzip.compress(raw));log({'earlyPublicationVerified':True,'modelled':p['modelled'],'evidenceIds':p['evidenceIds']})
 if s['MainPID']=='0' and (pid or s['ExecMainStartTimestamp']!=oldTerminal['ExecMainStartTimestamp']):break
 if time.monotonic()>deadline:raise RuntimeError('observation deadline; worker not restarted or killed')
 time.sleep(30)
assert subprocess.check_output(['systemctl','--user','cat',unit])==config;assert pointer.resolve().name==expected
result={'at':stamp(),'runtime':str(pointer.resolve()),'startedAt':started,'previousWorkerTerminal':oldTerminal,'workerSamples':samples,'terminal':s,'unitConfigurationSha256':hashlib.sha256(config).hexdigest(),'unitConfigurationUnchanged':True,'baseline':baseline,'publications':pubs,'earlyPublicationVerified':early is not None,'sharedHouseRestarted':False,'ordersPlaced':0};(out/'whole-cycle-receiving.json').write_text(json.dumps(result,indent=2)+'\n');log({'at':stamp(),'terminal':s,'earlyPublicationVerified':early is not None,'publishedSnapshots':len(pubs),'lastPublicationAt':pubs[-1]['at'] if pubs else None,'completeEvidencePublished':any(p['evidenceComplete'] for p in pubs)})
