from pathlib import Path
import gzip,json,hashlib,datetime
h=Path.home();root=h/'.local/state/561-group/settlements/kalshi-services-section/weather';out=h/'.local/state/561-group/weather-bounded-ensemble';eid='a37a434c22f0987099ddbbb3564f9c238c3eadc7e9bfb26d9bc86003ac0eb59d'
def packet(eid):
 p=root/'evidence'/(eid+'.json.gz');raw=gzip.decompress(p.read_bytes());assert hashlib.sha256(raw).hexdigest()==eid;return json.loads(raw),datetime.datetime.fromtimestamp(p.stat().st_ctime,datetime.timezone.utc).isoformat()
def clock(s):return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
def key(f):return (f['station'],f['model'],f['validTime'],f['availableAt'])
current,_=packet(eid);cells=[o for o in current['science']['outcomes'] if o['forecast'].get('verification')=='nws-report-cell-v1'];known={}
for old in ['3770e330a1a72d1649364eb897420afb2c62ffd4bca9eeea312f22abc04f5a97','2f1221abdbe4f4739bd9a69dfbb9549049d7a72cf1803e4cee7549f90dfb8987','4fa74dc5cd5d6958fa3a11a8961663a605ed35074e06d557ed60ebde922351c9','d16008737a0d1e63154b8a4dfc3d6f6807f603a149532ee25dbb49995b45a436','74b6a3c268799b0aa35a4cd1552c9d6df6cb7abf80c27b711d9bde50277728ec']:
 if not (root/'evidence'/(old+'.json.gz')).exists():continue
 p,visible=packet(old)
 for f in p.get('science',{}).get('forecasts',[]):
  if f.get('verification')=='nws-report-cell-v1':known.setdefault(key(f),[]).append((f,old,visible))
verified=[];unverified=[]
for o in cells:
 f=dict(o['forecast']);f.pop('sourceEvidenceId',None);obs=o['observation'];match=next(((other,old,at) for other,old,at in known.get(key(f),[]) if other==f and clock(at)<clock(f['earliestTargetObservationAt']) and clock(at)<clock(obs['at'])),None)
 if not match:unverified.append({'station':f['station'],'model':f['model'],'validTime':f['validTime'],'availableAt':f['availableAt'],'knownExactForecastCandidates':len(known.get(key(f),[]))});continue
 other,old,at=match;assert obs['status']=='identified';assert obs['measurementOperator']=='nws-metar-temperature-cell-v1';assert o['cellScores']['lowF']<=o['cellScores']['highF'];verified.append({'forecast':f,'observation':obs,'cellScores':o['cellScores'],'originalEvidenceId':old,'originalArchiveMetadataAt':at,'outcomeEvidenceId':eid})
unique={(r['forecast']['station'],r['observation']['at']) for r in verified};dates={r['forecast']['date'] for r in verified};groups={}
for r in verified:
 f=r['forecast'];k=f['station']+'/'+f['model'];a=groups.setdefault(k,{'station':f['station'],'model':f['model'],'records':0,'crpsLowSumF':0,'crpsHighSumF':0});a['records']+=1;a['crpsLowSumF']+=r['cellScores']['lowF'];a['crpsHighSumF']+=r['cellScores']['highF']
for a in groups.values():a['crpsLowMeanF']=a['crpsLowSumF']/a['records'];a['crpsHighMeanF']=a['crpsHighSumF']/a['records']
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scoredReportCellForecastRecords':len(cells),'exactPriorForecastAndPreWindowArchiveVerified':len(verified),'unverified':unverified,'uniqueStationReportCells':len(unique),'dates':sorted(dates),'models':list(groups.values()),'records':verified,'publicationBasis':'content-addressed forecast matches and actual immutable archive inode metadata time, conservatively before the entire target-observation window and selected report; machine-clock trust remains explicit','sensorErrorBoundEstablished':False,'physicalGeneralizationEstablished':False,'conditionalFillProbabilityIdentified':False,'netExecutableAlphaEstablished':False,'ordersPlaced':0};(out/'prospective-cell-outcomes-receiving.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['records','models','unverified']}));print(json.dumps({'unverifiedExamples':unverified[:3],'modelGroups':len(groups)}))
