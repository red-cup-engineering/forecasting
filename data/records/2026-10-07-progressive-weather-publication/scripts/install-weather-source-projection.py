from pathlib import Path
import subprocess,hashlib,json,uuid,tarfile,shlex
repo=Path('/home/emsenn/info');f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=Path(Path('/tmp/weather-progressive-record').read_text().strip());own=Path(Path('/tmp/weather-source-admission-root').read_text().strip())/'kalshi';rel=(f/'src/weather-engine.mjs').relative_to(repo);tool=repo/Path('/tmp/weather-source-patchset-tool').read_text().strip();staged=Path('/tmp/weather-source-projection-materialized-'+uuid.uuid4().hex)
subprocess.run(['python3',str(tool),str(r/'projection-input-inventory.json'),str(r/'projection-source-patchset.json'),str(staged)],check=True)
before=(r/'source-projection.before.mjs').read_bytes();candidate=(staged/rel).read_bytes();assert candidate==(r/'source-projection.candidate.mjs').read_bytes()
canonical=f/'src/weather-engine.mjs';ownfile=own/'services/forecasting-service/src/weather-engine.mjs';assert canonical.read_bytes()==before;assert ownfile.read_bytes()==before
canonical.write_bytes(candidate);ownfile.write_bytes(candidate);(r/'weather-engine.candidate.mjs').write_bytes(candidate)
for n in ['prepare-weather-source-projection.py','receive-weather-source-projection.mjs','install-weather-source-projection.py']:(r/'scripts'/n).write_bytes((Path('/tmp')/n).read_bytes())
complete=json.loads((r/'complete-source-patchset.json').read_text())
for c in complete['changes']:
 if c['path']==str(rel):c['replacements'][0]['after']=candidate.decode()
(r/'complete-source-patchset.json').write_text(json.dumps(complete,indent=2)+'\n')
patch=subprocess.check_output(['git','-C',str(own),'diff','--binary']);(r/'kalshi-owning-source.patch').write_bytes(patch);subprocess.run(['git','-C',str(own),'apply','--check','--reverse',str(r/'kalshi-owning-source.patch')],check=True)
archive=r/'projection-source-update.tar.gz'
with tarfile.open(archive,'w:gz') as t:
 for n in ['projection-input-inventory.json','projection-source-patchset.json']:t.add(r/n,arcname=n)
 t.add(tool,arcname='materializer.py');t.add(r/'scripts/update-retained-weather-runtime.py',arcname='update-runtime.py')
hostpath='/tmp/weather-source-projection-'+uuid.uuid4().hex
subprocess.run(['ssh','-o','BatchMode=yes','cold-red-gate','mkdir -p '+shlex.quote(hostpath)],check=True)
subprocess.run(['scp','-q',str(archive),'cold-red-gate:'+hostpath+'/source.tar.gz'],check=True)
cmd='export PATH=/home/emsenn/.nvm/versions/node/v24.16.0/bin:$PATH; tar -xzf '+shlex.quote(hostpath+'/source.tar.gz')+' -C '+shlex.quote(hostpath)+'; python3 '+shlex.quote(hostpath+'/update-runtime.py')+' '+ ' '.join(shlex.quote(hostpath+'/'+n) for n in ['projection-input-inventory.json','projection-source-patchset.json','materializer.py','source.tar.gz'])
result=subprocess.check_output(['ssh','-o','BatchMode=yes','cold-red-gate',cmd],text=True);lines=result.splitlines();receipt=json.loads(lines[-1]);(r/'projection-runtime-only-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
