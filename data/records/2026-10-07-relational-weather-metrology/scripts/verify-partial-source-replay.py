from pathlib import Path
import tempfile,subprocess,json,gzip,time,datetime,hashlib
f=Path(__file__).resolve().parents[4]
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);a=root/'evidence';a.mkdir();(root/'universe.json').write_text('{}');now=time.time();iso=lambda t:datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat()
 for e in [{'at':iso(now),'kind':'relational-temperature-science-v1','experiment':{}},{'at':iso(now),'stations':[{'station':'KJFK','timeZone':'America/New_York'}],'guidance':{'runtime':iso(now),'source':'https://example.org/controlled-guidance-fixture','stations':{'KJFK':{'rows':[{'ftime':iso(now+7200),'tmp':80,'tsd':2}]}}}}]:
  raw=json.dumps(e).encode();(a/(hashlib.sha256(raw).hexdigest()+'.json.gz')).write_bytes(gzip.compress(raw))
 r=json.loads(subprocess.check_output(['node',str(f/'apps/replay-station-weather-science.mjs'),'--archives',str(a),'--universe',str(root/'universe.json'),'--output',str(root/'replay')],text=True));assert r['packets']==1 and r['skipped']==1 and r['forecasted']>0
 receipt={'at':iso(time.time()),'fixture':'one controlled NBM-only weather packet and one research packet','acceptedWeatherPackets':r['packets'],'excludedResearchPackets':r['skipped'],'preservedWeatherForecasts':r['forecasted'],'liveStateModified':False};p=f/'data/records/2026-10-07-relational-weather-metrology/partial-source-replay-receipt.json';p.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
