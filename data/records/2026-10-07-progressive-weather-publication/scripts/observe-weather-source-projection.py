from pathlib import Path
import subprocess,time,json,datetime,hashlib,gzip
home=Path.home();out=home/'.local/state/561-group/weather-source-projection';out.mkdir(parents=True,exist_ok=True);root=home/'.local/state/561-group/settlements/kalshi-services-section/weather';pointer=home/'.local/share/561-group/weather-research/current';expected='ce66beed57909ba51c5d5a3062fa240fd69ea6f213c78358b150a4a09a23b201';unit='weather-561-group.service'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state():
 raw=subprocess.check_output(['systemctl','--user','show',unit,'-p','MainPID','-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp','-p','CPUUsageNSec','-p','MemoryPeak','-p','MemorySwapPeak'],text=True)
 return dict(l.split('=',1) for l in raw.splitlines() if '=' in l)
def emit(v):print(json.dumps(v),flush=True)
config=subprocess.check_output(['systemctl','--user','cat',unit]);assert pointer.resolve().name==expected;prior=state();baseline=json.loads((root/'latest.json').read_text());old=baseline['at'];pid=None;samples=[];pubs=[];deadline=time.monotonic()+650
emit({'at':stamp(),'initialState':prior,'previousPublicationAt':old,'waitingForExistingTimer':True})
while time.monotonic()<deadline:
 s=state();samples.append({'at':stamp(),**s})
 if s['MainPID']!='0':
  if pid is None:
   pid=s['MainPID'];cwd=Path('/proc/'+pid+'/cwd').resolve();assert cwd.is_relative_to(pointer.resolve());emit({'at':stamp(),'attachedToWorker':s,'cwd':str(cwd)})
  assert s['MainPID']==pid,'another worker started; no action taken'
 raw=(root/'latest.json').read_bytes();p=json.loads(raw)
 if p['at']!=old:
  old=p['at'];rec={k:p.get(k) for k in ['at','collectionStartedAt','complete','evidenceComplete','forecastLane','marketCount','modelled','acquisition','families','errors']};rec.update({'receivedAt':stamp(),'sha256':hashlib.sha256(raw).hexdigest(),'worker':s,'evidenceIds':sorted({r['evidenceId'] for r in p['forecasts']})});pubs.append(rec);emit({'newPublication':rec})
  if p.get('forecastLane')=='source-projection-v1' and p['modelled']>0 and s['MainPID']==pid:
   if not (out/'early-publication.json').exists():
    (out/'early-publication.json').write_text(json.dumps(rec,indent=2)+'\n');(out/'early-latest.json.gz').write_bytes(gzip.compress(raw))
    result=subprocess.run(['/home/emsenn/.nvm/versions/node/v24.16.0/bin/node',str(out/'verify-reader.mjs')],capture_output=True,text=True);emit({'readerExit':result.returncode,'readerOutput':result.stdout[-3000:],'readerError':result.stderr[-1000:]})
 if pid and s['MainPID']=='0':break
 time.sleep(10)
else:emit({'observationEndedWithoutTerminal':True})
result={'at':stamp(),'runtime':str(pointer.resolve()),'previousWorker':prior,'samples':samples,'publications':pubs,'terminal':s,'terminalObserved':bool(pid and s['MainPID']=='0'),'unitConfigurationUnchanged':subprocess.check_output(['systemctl','--user','cat',unit])==config,'serviceRestartRequested':False,'sharedHouseRestarted':False,'ordersPlaced':0};(out/'whole-cycle-receiving.json').write_text(json.dumps(result,indent=2)+'\n');emit({'terminal':s,'terminalObserved':result['terminalObserved'],'publications':len(pubs)})
