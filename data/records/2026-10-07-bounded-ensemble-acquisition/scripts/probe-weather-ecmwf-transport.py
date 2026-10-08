import pathlib,importlib.util,json,time,concurrent.futures,datetime,hashlib
home=pathlib.Path.home();runtime=(home/'.local/share/561-group/weather-research/current').resolve();manifest=json.loads((runtime/'manifest.json').read_text());decoder=runtime/manifest['entry'];decoder=decoder.with_name('weather-ecmwf-decode.py');spec=importlib.util.spec_from_file_location('weather_decoder',decoder);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);out=home/'.local/state/561-group/weather-ecmwf-transport-probe';out.mkdir(parents=True,exist_ok=True)
key='20261008/00z/aifs-ens/0p25/enfo/20261008000000-6h-enfo-cf.index';urls=[m.BASE+key]+[b+key for b in m.MIRRORS]
def probe(url):
 start=time.monotonic();r={'url':url,'startedAt':m.stamp()}
 try:
  b,receipt=m.fetch_resource(url);m.retain(out/'raw'/receipt['sha256'],b);r.update(status='received',receipt=receipt,indexRecords=len(b.splitlines()))
 except Exception as e:r.update(status='failed',errorType=type(e).__name__,error=str(e))
 r.update(finishedAt=m.stamp(),elapsedSeconds=time.monotonic()-start);print(json.dumps(r),flush=True);return r
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(probe,urls))
result={'runtime':str(runtime),'at':m.stamp(),'rows':rows,'ordersPlaced':0};(out/'receiving.json').write_text(json.dumps(result,indent=2)+'\n')
