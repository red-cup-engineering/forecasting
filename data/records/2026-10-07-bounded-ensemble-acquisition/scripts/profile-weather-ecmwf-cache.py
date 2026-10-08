import pathlib,importlib.util,json,time,datetime,gzip,resource,shutil,os
home=pathlib.Path.home();runtime=(home/'.local/share/561-group/weather-research/current').resolve();manifest=json.loads((runtime/'manifest.json').read_text());decoder=(runtime/manifest['entry']).with_name('weather-ecmwf-decode.py');spec=importlib.util.spec_from_file_location('weather_decoder',decoder);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);out=home/'.local/state/561-group/weather-ecmwf-cache-profile';out.mkdir(parents=True,exist_ok=True);live=home/'.local/state/561-group/settlements/kalshi-services-section/weather';raw=gzip.decompress((live/'evidence/3948922a222cf689e6a77beb74b6c75cc3c4ef09ad573c97200f2dde53ba909d.json.gz').read_bytes());source=json.loads(raw);stations=[]
for s in source['stations']:
 meta=source.get('stationMetadata',{}).get(s['station']) or source.get('local',{}).get(s['station'])
 if meta:stations.append({**s,**meta})
del raw,source
cache=out/'cache';start=time.monotonic()
if not cache.exists():shutil.copytree(live/'ecmwf',cache,copy_function=os.link)
print(json.dumps({'at':m.stamp(),'cacheCloneSeconds':time.monotonic()-start,'stations':len(stations)}),flush=True)
old=m.acquire
stats={'acquisitions':0,'cacheHits':0,'uncached':0,'acquireSeconds':0}
def acquire(root,url,offset=None,length=None,index_sha256=None):
 t=time.monotonic();key=m.sha(json.dumps([url,offset,length]).encode());hit=(root/'receipts'/(key+'.json')).exists();stats['acquisitions']+=1;stats['cacheHits' if hit else 'uncached']+=1
 if offset is None:print(json.dumps({'at':m.stamp(),'indexStarted':url,'cacheHit':hit}),flush=True)
 try:return old(root,url,offset,length,index_sha256)
 finally:
  stats['acquireSeconds']+=time.monotonic()-t
  if offset is None:print(json.dumps({'at':m.stamp(),'indexFinished':url,'elapsedSeconds':time.monotonic()-t}),flush=True)
m.acquire=acquire;started=m.stamp();t=time.monotonic();options={'stations':stations,'cacheDir':str(cache),'validCount':1,'now':m.stamp()}
try:
 packet=m.collect(options);b=json.dumps(packet,allow_nan=False).encode();evidenceId=m.sha(b);(out/'packet.json.gz').write_bytes(gzip.compress(b));result={'status':'completed','at':m.stamp(),'runtime':str(runtime),'startedAt':started,'elapsedSeconds':time.monotonic()-t,'cpuSeconds':resource.getrusage(resource.RUSAGE_SELF).ru_utime+resource.getrusage(resource.RUSAGE_SELF).ru_stime,'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'options':options,'stats':stats,'forecastRun':packet['runtime'],'fields':len(packet['fields']),'stations':len(packet['stations']),'evidenceId':evidenceId,'projection':packet['projection'],'ordersPlaced':0};(out/'receiving.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='options'}),flush=True)
except Exception as e:
 print(json.dumps({'status':'failed','at':m.stamp(),'elapsedSeconds':time.monotonic()-t,'error':repr(e),'stats':stats}),flush=True);raise
