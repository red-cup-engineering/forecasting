import pathlib,importlib.util,tempfile,urllib.error,urllib.request,json,datetime,io
f=pathlib.Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('decoder',f/'src/weather-ecmwf-decode.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
root=pathlib.Path(tempfile.mkdtemp(prefix='controlled-ecmwf-mirror-'));key='20261007/12z/aifs-ens/0p25/enfo/20261007120000-12h-enfo-cf';google=d.MIRRORS[1]
index,ir=d.acquire(root,google+key+'.index');row=next(json.loads(l) for l in index.splitlines() if json.loads(l).get('param')=='2t' and json.loads(l).get('levtype')=='sfc');offset,length=row['_offset'],row['_length'];original=urllib.request.urlopen
calls=[]
def controlled(request,*args,**kwargs):
 url=request.full_url if isinstance(request,urllib.request.Request) else request;calls.append(url)
 if url.startswith(d.BASE) or url.startswith(d.MIRRORS[0]):raise urllib.error.HTTPError(url,503,'injected transport failure for mechanics verification',{},None)
 return original(request,*args,**kwargs)
try:
 urllib.request.urlopen=controlled
 field,r=d.acquire(root,d.BASE+key+'.grib2',offset,length,ir['sha256'])
finally:urllib.request.urlopen=original
assert r['url']==google+key+'.grib2' and r['requestedUrl']==d.BASE+key+'.grib2' and len(r['transportAttempts'])==2 and r['indexVerification']['sha256']==ir['sha256']
run=datetime.datetime(2026,10,7,12,tzinfo=datetime.timezone.utc);valid=run+datetime.timedelta(hours=12);record={**row,'step':12,'member':0};metadata,projected=d.decode(field,record,run,valid,[{'station':'KLGA','latitude':40.77944,'longitude':-73.88028}]);assert metadata['dataDate']==20261007 and metadata['validityDate']==20261008
before=len(calls);cached,cr=d.acquire(root,d.BASE+key+'.grib2',offset,length,ir['sha256']);assert cached==field and cr==r and len(calls)==before
try:d.acquire(root,d.BASE+key+'.grib2',offset,length,'0'*64)
except ValueError:pass
else:raise AssertionError('conflicting cached index was accepted')
try:d.transport_index(root,google+key+'.index','0'*64)
except ValueError:pass
else:raise AssertionError('conflicting mirror index was accepted')
result={'at':d.stamp(),'mode':'controlled primary and regional HTTP failures; successful mirror uses real public bytes; injected failures do not describe source operation','temporaryEvidenceRoot':str(root),'requestedUrl':r['requestedUrl'],'successfulTransport':r['url'],'indexSha256':ir['sha256'],'fieldSha256':r['sha256'],'fieldBytes':r['bytes'],'fieldAvailableAt':r['availableAt'],'indexVerification':r['indexVerification'],'failedTransports':2,'exactRangeRequired':True,'decodedMetadataMatched':True,'projection':projected,'cachedFirstReceiptPreserved':True,'conflictingCachedIndexRefused':True,'conflictingMirrorIndexRefused':True,'orderEffect':False};print(json.dumps(result))
