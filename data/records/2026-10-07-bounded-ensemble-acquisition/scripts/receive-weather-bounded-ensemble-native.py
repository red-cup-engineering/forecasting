import pathlib,importlib.util,json,time,resource,gzip,urllib.error,sys
home=pathlib.Path.home();out=home/'.local/state/561-group/weather-bounded-ensemble';which=sys.argv[1];spec=importlib.util.spec_from_file_location('decoder',out/(which+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
prior=json.loads((home/'.local/state/561-group/weather-ecmwf-cache-profile/receiving.json').read_text());options=prior['options'];options['stations']=[{k:s[k] for k in ['station','timeZone','latitude','longitude']} for s in options['stations']];cache=pathlib.Path(options['cacheDir']);probe=json.loads((home/'.local/state/561-group/weather-ecmwf-transport-probe/receiving.json').read_text());failures={r['url']:r for r in probe['rows']};assert all(r['error']=='HTTP Error 404: Not Found' for r in failures.values());network=[]
def observed_failure(url,offset=None,length=None):
 if offset is not None or url not in failures:raise AssertionError('unexpected uncached transport '+url)
 network.append(url);raise urllib.error.HTTPError(url,404,'Not Found',{},None)
m.fetch_resource=observed_failure;sha0=m.sha;field_hashes=0
# Count the field-wide hashes, whose operands are the archived GRIB bytes.
def sha(b):
 global field_hashes
 if b[:4]==b'GRIB':field_hashes+=1
 return sha0(b)
m.sha=sha;t=time.monotonic();started=m.stamp();packet=m.collect(options);elapsed=time.monotonic()-t;raw=json.dumps(packet,allow_nan=False).encode();(out/(which+'-packet.json.gz')).write_bytes(gzip.compress(raw));result={'version':which,'startedAt':started,'finishedAt':m.stamp(),'optionsNow':options['now'],'stations':len(options['stations']),'fields':len(packet['fields']),'ensembleMembers':packet['members'],'elapsedSeconds':elapsed,'cpuSeconds':resource.getrusage(resource.RUSAGE_SELF).ru_utime+resource.getrusage(resource.RUSAGE_SELF).ru_stime,'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'fieldHashComputations':field_hashes,'observed404Replay':network,'fieldArchive':'weather-ecmwf-cache-profile/cache','coordinatesBasis':'45 coordinates retained by the actual NWS hourly source snapshot; diagnostic receiving did not reacquire the 3 missing hourly station responses','sourceEvidenceId':'3948922a222cf689e6a77beb74b6c75cc3c4ef09ad573c97200f2dde53ba909d','evidenceId':sha0(raw),'ordersPlaced':0};(out/(which+'-receiving.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
