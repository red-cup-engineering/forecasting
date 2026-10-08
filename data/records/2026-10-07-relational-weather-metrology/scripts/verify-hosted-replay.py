from pathlib import Path
import json,tempfile,shutil,subprocess,urllib.request,datetime
home=Path.home();release=(home/'.local/share/561-group/releases/cold-red-gate.561.group/current').resolve()
receipt=json.loads((home/'.local/state/561-group/weather-relational-demonstration/live-tool-receipt.json').read_text())
with tempfile.TemporaryDirectory(prefix='relational-carrier-verification-') as temp:
 root=Path(temp);archive=root/'evidence';archive.mkdir();(root/'universe.json').write_text('{}')
 for experiment in receipt['experiments']:
  name=experiment['evidenceId']+'.json.gz';shutil.copyfile(home/'.local/state/561-group/settlements/kalshi-services-section/weather/evidence'/name,archive/name)
 output=subprocess.check_output(['node',str(release/'lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/web3-platform-services-section/web3-gambling-platform-services-section/services/kalshi-services-section/services/forecasting-service/apps/replay-station-weather-science.mjs'),'--archives',str(archive),'--universe',str(root/'universe.json'),'--output',str(root/'replay')],text=True)
 replay=json.loads(output);assert replay['packets']==0 and replay['skipped']==2 and replay['scored']==0 and replay['forecasted']==0
 assert not (root/'replay/state.json').exists()
with urllib.request.urlopen('https://cold-red-gate.561.group/healthz',timeout=20) as health:assert health.status==200
receipt['finalHostRelease']=str(release);receipt['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();receipt['stationReplay']={k:replay[k] for k in ['packets','skipped','scored','forecasted']};receipt['stationReplay']['calibrationStateCreated']=False
(home/'.local/state/561-group/weather-relational-demonstration/live-tool-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'hostRelease':str(release),'stationReplay':receipt['stationReplay'],'publicHealth':200,'orderEffect':False}))
