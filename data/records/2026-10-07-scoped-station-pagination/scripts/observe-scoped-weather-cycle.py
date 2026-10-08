from pathlib import Path
import subprocess,time,json,datetime,hashlib,os
home=Path.home();out=home/'.local/state/561-group/weather-scoped-pagination';out.mkdir(parents=True,exist_ok=True);root=home/'.local/state/561-group/settlements/kalshi-services-section/weather';pointer=home/'.local/share/561-group/weather-research/current';expected='4202edb8c76cca37ef8a6a4ac9f4a9da8488273d5567bee68c2a7aae442d889e';unit='weather-561-group.service'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state():
 raw=subprocess.check_output(['systemctl','--user','show',unit,'-p','MainPID','-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp','-p','CPUUsageNSec','-p','MemoryPeak','-p','MemorySwapPeak'],text=True)
 return dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
def log(v):print(json.dumps(v),flush=True)
def summary():
 p=root/'latest.json'
 if not p.exists():return None
 raw=p.read_bytes();d=json.loads(raw)
 return {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'at':d.get('at'),'collectionStartedAt':d.get('collectionStartedAt'),'complete':d.get('complete'),'marketCount':d.get('marketCount'),'modelled':d.get('modelled'),'families':d.get('families'),'errors':d.get('errors'),'science':d.get('science'),'orderEffect':d.get('orderEffect')}
config=subprocess.check_output(['systemctl','--user','cat',unit]);before=state();baseline=summary();log({'at':stamp(),'existingWorker':before,'baselineAt':baseline.get('at') if baseline else None})
# Preserve the already running worker and wait for its authoritative termination.
deadline=time.monotonic()+240
while state()['MainPID']!='0':
 if time.monotonic()>deadline:raise RuntimeError('existing worker remains active; no replacement started')
 time.sleep(35);log({'at':stamp(),'waitingForExistingWorker':state()})
oldTerminal=state();assert pointer.resolve().name==expected,'producer changed before native receiving'
subprocess.run(['systemctl','--user','start','--no-block',unit],check=True)
started=stamp();deadline=time.monotonic()+620;pid=None;samples=[]
while True:
 s=state();samples.append({'at':stamp(),**s});log({'at':stamp(),'receivingWorker':s})
 if s['MainPID']!='0':pid=s['MainPID']
 if s['MainPID']=='0' and (pid or s['ExecMainStartTimestamp']!=oldTerminal['ExecMainStartTimestamp']):break
 if time.monotonic()>deadline:raise RuntimeError('native receiving observation deadline; existing worker not restarted or killed')
 time.sleep(35)
after=summary();configAfter=subprocess.check_output(['systemctl','--user','cat',unit]);assert configAfter==config,'worker configuration changed';assert pointer.resolve().name==expected,'producer changed during native receiving'
receipt={'at':stamp(),'runtime':str(pointer.resolve()),'startedAt':started,'previousWorkerTerminal':oldTerminal,'workerSamples':samples,'terminal':s,'unitConfigurationSha256':hashlib.sha256(config).hexdigest(),'unitConfigurationUnchanged':True,'baseline':baseline,'publication':after,'newPublication':bool(after and baseline and after['sha256']!=baseline['sha256'] and datetime.datetime.fromisoformat(after['at'].replace('Z','+00:00'))>=datetime.datetime.fromisoformat(started)),'sharedHouseRestarted':False,'ordersPlaced':0}
(out/'whole-cycle-receiving.json').write_text(json.dumps(receipt,indent=2)+'\n');log({'at':stamp(),'receivingTerminal':s,'newPublication':receipt['newPublication'],'publicationAt':after.get('at') if after else None,'marketCount':after.get('marketCount') if after else None,'modelled':after.get('modelled') if after else None})
