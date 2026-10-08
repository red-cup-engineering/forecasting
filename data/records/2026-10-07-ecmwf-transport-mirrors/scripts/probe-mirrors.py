import urllib.request, pathlib, json, hashlib,datetime,time,concurrent.futures
f=pathlib.Path(__file__).resolve().parents[4];root=f/'data/records/2026-10-07-ecmwf-transport-mirrors';(root/'raw').mkdir(parents=True,exist_ok=True)
key='20261007/12z/aifs-ens/0p25/enfo/20261007120000-12h-enfo-cf'
urls=['https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/','https://storage.googleapis.com/ecmwf-open-data/','https://data.ecmwf.int/forecasts/']
def probe(base):
 start=time.monotonic();result={'base':base,'requestedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  url=base+key+'.index'
  with urllib.request.urlopen(url,timeout=20) as r:b=r.read(3_000_001);result['indexStatus']=r.status;result['indexReceivedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  assert len(b)<=3_000_000
  ih=hashlib.sha256(b).hexdigest();(root/'raw'/ih).write_bytes(b);result['indexSha256']=ih;result['indexBytes']=len(b)
  rows=[json.loads(x) for x in b.splitlines()];row=next(r for r in rows if r.get('param')=='2t' and r.get('levtype')=='sfc');off=row['_offset'];length=row['_length'];assert 10000<=length<=2_000_000
  req=urllib.request.Request(base+key+'.grib2',headers={'Range':f'bytes={off}-{off+length-1}'})
  with urllib.request.urlopen(req,timeout=20) as r:data=r.read(length+1);result.update(fieldStatus=r.status,contentRange=r.headers.get('Content-Range'),etag=r.headers.get('ETag'),lastModified=r.headers.get('Last-Modified'),fieldReceivedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
  assert result['fieldStatus']==206 and result['contentRange'].startswith(f'bytes {off}-{off+length-1}/') and len(data)==length and data[:4]==b'GRIB' and data[-4:]==b'7777' and int.from_bytes(data[8:16],'big')==length
  h=hashlib.sha256(data).hexdigest();(root/'raw'/h).write_bytes(data);result.update(fieldSha256=h,fieldBytes=length,rangeOffset=off,indexRecord=row)
 except Exception as e:result['error']=str(e)
 result['elapsedSeconds']=time.monotonic()-start;return result
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(probe,urls))
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'key':key,'receipts':results,'successfulMirrors':sum('fieldSha256' in r for r in results),'sameIndexSha256':len(set(r['indexSha256'] for r in results if 'fieldSha256' in r))==1,'sameFieldSha256':len(set(r['fieldSha256'] for r in results if 'fieldSha256' in r))==1,'officialSourceRegistry':'https://raw.githubusercontent.com/ecmwf/ecmwf-opendata/main/ecmwf/opendata/urls.py','scope':'bounded real transport compatibility probe; no forecast-skill or reliability-frequency inference','orderEffect':False};(root/'probe-receipt.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
