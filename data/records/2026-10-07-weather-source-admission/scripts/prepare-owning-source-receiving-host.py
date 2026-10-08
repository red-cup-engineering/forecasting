from pathlib import Path
import tarfile,json,uuid,os
home=Path.home();house=(home/'.local/share/561-group/releases/cold-red-gate.561.group/current').resolve();candidate=Path('/tmp')/('weather-owning-source-'+uuid.uuid4().hex);candidate.mkdir(mode=0o700)
with tarfile.open('/tmp/weather-owning-source-candidate.tar.gz') as tar:tar.extractall(candidate,filter='data')
owners={'@red-cup-engineering/kalshi-services-section':candidate/'kalshi','@red-cup-engineering/forecasting':candidate/'kalshi/services/forecasting-service','@561-group/group-operations':candidate/'operations/apps/group-operations'}
for name,new in owners.items():
 old=(house/'node_modules'/name).resolve(strict=True);modules=new/'node_modules';modules.mkdir(exist_ok=True)
 for scope in old.parent.parent.iterdir():
  if not scope.is_dir():continue
  entries=list(scope.iterdir()) if scope.name.startswith('@') else [scope]
  for entry in entries:
   if entry.name.startswith('.'):continue
   relative=entry.relative_to(old.parent.parent);target=modules/relative
   if target.exists() or target.is_symlink():continue
   target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(entry.resolve(),target_is_directory=entry.is_dir())
 for dependency,source in owners.items():
  link=modules/dependency
  if link.exists() or link.is_symlink():link.unlink()
  link.parent.mkdir(parents=True,exist_ok=True);link.symlink_to(source,target_is_directory=True)
# The actual installed-host reader resolves the candidate package factory by its export.
(candidate/'node_modules').mkdir()
for name,source in owners.items():
 link=candidate/'node_modules'/name;link.parent.mkdir(parents=True,exist_ok=True);link.symlink_to(source,target_is_directory=True)
(candidate/'host.json').write_bytes((house/'deployment/host.json').read_bytes());(candidate/'manifest.json').write_text(json.dumps({'entry':'kalshi/services/forecasting-service/src/weather-engine.mjs'})+'\n')
(home/'.local/state/561-group/weather-source-admission').mkdir(exist_ok=True,mode=0o700);(home/'.local/state/561-group/weather-source-admission/candidate.json').write_text(json.dumps({'candidate':str(candidate),'house':str(house),'dependencies':'same immutable admitted dependency packages; owning weather packages overridden in isolated candidate only'})+'\n');print(candidate)
