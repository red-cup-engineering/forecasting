from pathlib import Path
import os,sys,json,hashlib,shutil,subprocess,uuid,datetime
if len(sys.argv)!=5:raise SystemExit('usage: update-retained-weather-runtime.py INVENTORY PATCHSET MATERIALIZER SOURCE_ARCHIVE')
home=Path.home();pointer=home/'.local/share/561-group/weather-research/current';donor=pointer.resolve(strict=True)
archive=Path(sys.argv[4]);source_archive=hashlib.sha256(archive.read_bytes()).hexdigest();record=home/'.local/state/561-group/weather-deployments'/source_archive;record.mkdir(parents=True,exist_ok=True)
inventory=json.loads(Path(sys.argv[1]).read_text());inventory['sourceRoot']=str(donor);pinned=record/'runtime-input-inventory.json';pinned.write_text(json.dumps(inventory,indent=2)+'\n')
patches=record/'patches';subprocess.run([sys.executable,sys.argv[3],str(pinned),sys.argv[2],str(patches)],check=True)
stage=pointer.parent/'releases'/('.candidate-'+uuid.uuid4().hex);shutil.copytree(donor,stage,symlinks=True,copy_function=os.link)
try:
 for name in inventory['files']:
  candidate=patches/name;target=stage/name;tmp=target.with_name(target.name+'.incoming');tmp.write_bytes(candidate.read_bytes());tmp.replace(target)
 manifest=json.loads((stage/'manifest.json').read_text());entry=stage/manifest['entry'];node=shutil.which('node')
 trace="""import {registerHooks} from 'node:module';import {realpathSync} from 'node:fs';import {fileURLToPath,pathToFileURL} from 'node:url';const files=new Set();registerHooks({load(url,c,next){if(url.startsWith('file:'))files.add(realpathSync(fileURLToPath(url)));return next(url,c);}});await import(pathToFileURL(process.argv[1]));console.log(JSON.stringify([...files]));"""
 loaded=json.loads(subprocess.check_output([node,'--input-type=module','-e',trace,str(entry)],text=True));assert all(Path(p).is_relative_to(stage) for p in loaded),'dependency escapes retained closure'
 identity=hashlib.sha256();files=[]
 for p in sorted(stage.rglob('*')):
  name=str(p.relative_to(stage)).encode()
  if p.is_symlink():identity.update(b'L'+name+b'\0'+os.readlink(p).encode()+b'\0')
  elif p.is_file():identity.update(b'F'+name+b'\0'+p.read_bytes()+b'\0');files.append(p)
 runtime=stage.with_name(identity.hexdigest())
 if runtime.exists():shutil.rmtree(stage)
 else:stage.replace(runtime)
 assert pointer.resolve()==donor,'producer changed during staged update'
 pending=pointer.with_name('current.pending-'+str(os.getpid()));pending.symlink_to(runtime);pending.replace(pointer)
 receipt={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceArchive':source_archive,'hostRelease':str((home/'.local/share/561-group/releases/cold-red-gate.561.group/current').resolve()),'retainedRuntime':str(runtime),'previousRuntime':str(donor),'retainedFiles':len(files),'sourcePathsChanged':list(inventory['files']),'patchsetMaterializer':'existing deterministic source-patchset materializer','retainedDependencyClosureVerified':True,'sharedHouseWritten':False,'houseRestartRequested':False,'serviceConfigurationChanged':False,'ordersPlaced':0}
 (record/'runtime-only-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
finally:
 if stage.exists():shutil.rmtree(stage)
