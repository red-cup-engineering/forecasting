import subprocess,json,time,os
from pathlib import Path
r=Path(Path('/tmp/weather-stream-archive-record').read_text().strip());runtime=json.loads((r/'runtime-only-receipt.json').read_text())['retainedRuntime']
code='''import subprocess,json,time,os
from pathlib import Path
runtime=RUNTIME
fields=['ActiveState','SubState','MainPID','Result','ExecMainStartTimestamp','ExecMainExitTimestamp','MemoryPeak','MemorySwapPeak','CPUUsageNSec']
def props():
 out=subprocess.check_output(['systemctl','--user','show','weather-561-group.service',*["-p"+f for f in fields]],text=True)
 return dict(line.split('=',1) for line in out.splitlines())
before=props();started=False
if before['MainPID']=='0' and before['ActiveState'] in ['inactive','failed'] and before['ExecMainExitTimestamp']:
 subprocess.run(['systemctl','--user','start','--no-block','weather-561-group.service'],check=True);started=True
for _ in range(30):
 p=props();pid=int(p['MainPID']);cwd=None
 try: cwd=os.readlink('/proc/'+str(pid)+'/cwd') if pid else None
 except (FileNotFoundError,PermissionError): pass
 if cwd and (cwd==runtime or cwd.startswith(runtime+'/')):break
 if pid==0 and p['ActiveState']=='inactive':break
 time.sleep(.5)
assert cwd and (cwd==runtime or cwd.startswith(runtime+'/')),(p,cwd)
print(json.dumps({'before':before,'started':started,'pid':pid,'cwd':cwd,'current':p}))
'''.replace('RUNTIME',repr(runtime))
result=subprocess.run(['ssh','-o','BatchMode=yes','cold-red-gate','python3 -'],input=code,text=True,capture_output=True);print(result.stdout+result.stderr);result.check_returncode();(r/'native-start-receipt.json').write_text(json.dumps(json.loads(result.stdout),indent=2)+'\n')
