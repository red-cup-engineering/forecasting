from pathlib import Path
import json,gzip,base64,urllib.request,urllib.parse,hashlib,datetime
r=Path.home()/'.local/state/561-group/weather-temperature-cells';e=json.loads(gzip.decompress((r/'live-producer-evidence.json.gz').read_bytes()));o=next(iter(e['observations'].values()));p=o['rawPages'][0];packet=json.loads(gzip.decompress(base64.b64decode(p['body'])));u=urllib.parse.urlsplit(packet['pagination']['next']);q=urllib.parse.parse_qs(u.query);original=urllib.parse.parse_qs(urllib.parse.urlsplit(p['url']).query)
for name in ['start','end','limit']:q[name]=original[name]
url=urllib.parse.urlunsplit(u._replace(query=urllib.parse.urlencode(q,doseq=True)));start=datetime.datetime.now(datetime.timezone.utc)
req=urllib.request.Request(url,headers={'User-Agent':'(561 Group weather desk, ops@561.group)','Accept':'application/geo+json'})
with urllib.request.urlopen(req,timeout=30) as response:raw=response.read();status=response.status
payload=json.loads(raw);result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':url,'status':status,'features':len(payload.get('features',[])),'pagination':payload.get('pagination'),'sha256':hashlib.sha256(raw).hexdigest(),'elapsedSeconds':(datetime.datetime.now(datetime.timezone.utc)-start).total_seconds(),'scope':original,'station':o['station']};(r/'scoped-pagination-probe.json').write_text(json.dumps(result,indent=2)+'\n');(r/'scoped-pagination-probe-body.json').write_bytes(raw);print(json.dumps(result))
