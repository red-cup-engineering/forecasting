from pathlib import Path
import subprocess,json,hashlib,uuid
r=Path(Path('/tmp/weather-stream-archive-record').read_text().strip());remote='/tmp/weather-stream-profile-'+uuid.uuid4().hex;subprocess.run(['ssh','-o','BatchMode=yes','cold-red-gate','mkdir -p '+remote],check=True)
for local,name in [(r/'weather-engine.before.mjs','before.mjs'),(r/'weather-engine.candidate.mjs','candidate.mjs'),(r/'full-native-evidence.fixture.json.gz','fixture.json.gz'),(Path('/tmp/profile-weather-stream-archive.mjs'),'profile.mjs')]:subprocess.run(['scp','-q',str(local),'cold-red-gate:'+remote+'/'+name],check=True)
results=[]
for mode in ['before','candidate']:
 cmd='/home/emsenn/.nvm/versions/node/v24.16.0/bin/node --expose-gc '+remote+'/profile.mjs '+mode+' '+remote+'/'+mode+'.mjs '+remote+'/fixture.json.gz '+remote+'/'+mode+'-out';result=subprocess.run(['ssh','-o','BatchMode=yes','cold-red-gate',cmd],text=True,capture_output=True);(r/(mode+'-native-profile.log')).write_text(result.stdout+result.stderr);print((result.stdout+result.stderr)[-2500:],flush=True);result.check_returncode();row=json.loads(result.stdout.strip().splitlines()[-1]);results.append(row)
assert results[0]['evidenceId']==results[1]['evidenceId']=='a37a434c22f0987099ddbbb3564f9c238c3eadc7e9bfb26d9bc86003ac0eb59d';(r/'native-profile-receiving.json').write_text(json.dumps({'remote':remote,'results':results,'sameActualFullEvidenceId':True},indent=2)+'\n')
