import pathlib,json,importlib.util,datetime,time,sys
sys.dont_write_bytecode=True
home=pathlib.Path.home();runtime=(home/'.local/share/561-group/weather-research/current').resolve();module=next(runtime.glob('lib/**/forecasting-service/src/weather-ecmwf-decode.py'));spec=importlib.util.spec_from_file_location('weather',module);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
e=json.loads(pathlib.Path('/tmp/weather-current-source-evidence.json').read_text());stations=[{'station':s,'latitude':p['latitude'],'longitude':p['longitude']} for s,p in e['local'].items()]
root=home/'.local/state/561-group/settlements/kalshi-services-section/weather/ecmwf';receipt=next(json.loads(p.read_text()) for p in (root/'receipts').glob('*.json') if '20261007060000-12h-enfo-pf.grib2' in json.loads(p.read_text())['url'] and json.loads(p.read_text())['offset']==44558486);b=(root/'raw'/receipt['sha256']).read_bytes();run=datetime.datetime(2026,10,7,6,tzinfo=d.UTC);valid=run+datetime.timedelta(hours=12)
t=time.perf_counter();metadata,new=d.decode(b,{'step':12,'type':'pf','member':35},run,valid,stations);vector_ms=(time.perf_counter()-t)*1000
g=d.eccodes.codes_new_from_message(b);old={};t=time.perf_counter()
try:
 for s in stations:
  points=[dict(p) for p in d.eccodes.codes_grib_find_nearest(g,s['latitude'],s['longitude'],npoints=4)];value,_=d.bilinear(points,s['latitude'],s['longitude']);old[s['station']]=(value-273.15)*9/5+32
finally:d.eccodes.codes_release(g)
nearest_ms=(time.perf_counter()-t)*1000;max_error=max(abs(old[s]-new[s]['temperatureF']) for s in old);assert max_error<1e-9
record={'at':d.stamp(),'stations':len(stations),'sourceFieldSha256':receipt['sha256'],'run':run.isoformat(),'validTime':valid.isoformat(),'member':35,'vectorMs':vector_ms,'repeatedNearestMs':nearest_ms,'speedup':nearest_ms/vector_ms,'maxProjectionDifferenceF':max_error,'scope':'single real field, actual full-collector station geometry; code-path benchmark, not forecast skill or whole-cycle latency','orderEffect':False};(home/'.local/state/561-group/joint-index-demonstration/grid-benchmark.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
