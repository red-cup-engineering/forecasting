import subprocess,json,time
from pathlib import Path
r=Path(Path('/tmp/weather-receipt-publication-record').read_text().strip());start=json.loads((r/'native-start-receipt.json').read_text());pid=start['pid'];runtime=json.loads((r/'runtime-only-receipt.json').read_text())['retainedRuntime'];startstamp=start['current']['ExecMainStartTimestamp'];code='''import subprocess,json,time,gzip,datetime
from pathlib import Path
root=Path.home()/'.local/state/561-group/settlements/kalshi-services-section/weather'
fields=['ActiveState','SubState','MainPID','Result','ExecMainStartTimestamp','ExecMainExitTimestamp','MemoryPeak','MemorySwapPeak','CPUUsageNSec']
startstamp=STARTSTAMP;pid=__PINNED_PID__;seen=set()
for _ in range(35):
 out=subprocess.check_output(['systemctl','--user','show','weather-561-group.service',*["-p"+f for f in fields]],text=True);p=dict(line.split('=',1) for line in out.splitlines());row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'unit':p,'publications':[]}
 for path in (root/'evidence').glob('*.json.gz'):
  if path.name in seen or time.time()-path.stat().st_ctime>900:continue
  seen.add(path.name)
  try:
   with gzip.open(path,'rb') as f: head=f.read(180)
   if b'"station-forecast-publication-v1"' not in head:continue
   with gzip.open(path,'rt') as f:packet=json.load(f)
   row['publications'].append({'evidenceId':path.stem.removesuffix('.json'),'generatedAt':packet['generatedAt'],'mode':packet['mode'],'forecasts':len(packet['forecasts']),'sourceEvidenceId':packet['sourceEvidenceId'],'ctime':path.stat().st_ctime})
  except (OSError,ValueError):pass
 try:
  latest=json.loads((root/'latest.json').read_text());row['latest']={k:latest.get(k) for k in ['at','evidenceId','evidenceComplete','forecastLane','stationAcquisition','sourceAcquisition']};row['latest']['markets']=len(latest.get('markets',[])) if isinstance(latest.get('markets'),list) else None
 except (OSError,ValueError):pass
 print(json.dumps(row),flush=True)
 if p['ExecMainStartTimestamp']!=startstamp or p['MainPID']=='0' and p['ActiveState']=='inactive':break
 time.sleep(20)
'''.replace('STARTSTAMP',repr(startstamp)).replace('__PINNED_PID__',str(pid));rows=[]
p=subprocess.Popen(['ssh','-o','BatchMode=yes','cold-red-gate','python3 -u -'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);p.stdin.write(code);p.stdin.close()
for line in p.stdout:
 row=json.loads(line);rows.append(row);(r/'whole-cycle-observations.json').write_text(json.dumps(rows,indent=2)+'\n');print(line,flush=True)
err=p.stderr.read();rc=p.wait();print(err,flush=True);assert rc==0,rc
