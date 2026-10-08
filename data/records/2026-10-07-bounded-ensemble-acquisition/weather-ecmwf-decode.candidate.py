"""Bounded, losslessly retained ECMWF AIFS ENS 2m-temperature fields. ecCodes 2.49."""
import concurrent.futures, datetime as dt, hashlib, json, math, os, pathlib, sys, tempfile, urllib.request, urllib.error, threading
import eccodes
from collections import deque
RESERVE=512*1024*1024
UTC=dt.timezone.utc
BASE="https://ecmwf-forecasts.s3.amazonaws.com/"
# Official replicas from ECMWF's ecwmf-opendata source registry. Azure needs SAS.
MIRRORS=("https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/","https://storage.googleapis.com/ecmwf-open-data/","https://data.ecmwf.int/forecasts/")
TRANSIENT_HTTP={404,408,429,500,502,503,504}
_INDEX_WITNESSES={}
_INDEX_LOCK=threading.Lock()
def stamp(): return dt.datetime.now(UTC).isoformat().replace("+00:00","Z")
def sha(b): return hashlib.sha256(b).hexdigest()
def retain(path,b):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(dir=path.parent,prefix=".incoming-")
    try:
        with os.fdopen(fd,"wb") as out: out.write(b)
        try: os.link(name,path)
        except FileExistsError: pass
    finally: os.unlink(name)
def fetch_resource(url,offset=None,length=None):
    headers={"User-Agent":"561-group weather science; ECMWF public open data"}
    if offset is not None: headers["Range"]=f"bytes={offset}-{offset+length-1}"
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=20) as response:
        limit=length if length is not None else 3_000_000
        if offset is not None:
            if response.status!=206 or not response.headers.get("Content-Range","").startswith(f"bytes {offset}-{offset+length-1}/"): raise ValueError("exact HTTP byte range required")
        b=response.read(limit+1)
        if len(b)>limit or length is not None and len(b)!=length: raise ValueError("bounded response length mismatch")
        r={"url":url,"availableAt":stamp(),"sha256":sha(b),"bytes":len(b),"offset":offset,"contentRange":response.headers.get("Content-Range"),"etag":response.headers.get("ETag"),"lastModified":response.headers.get("Last-Modified")}
    return b,r

def transport_index(root,url,expected):
    # Three field workers share one exact-index validation per transport/object.
    with _INDEX_LOCK:
        known=_INDEX_WITNESSES.get(url)
        if known is None:
            b,known=fetch_resource(url)
            if known["sha256"]!=expected: raise ValueError("official mirror index differs from selected immutable index")
            v=os.statvfs(root)
            if v.f_bavail*v.f_frsize<len(b)+RESERVE: raise OSError("512MiB operating reserve required before mirror index evidence write")
            retain(root/"raw"/known["sha256"],b)
            retain(root/"transport-receipts"/(sha(json.dumps([url,expected]).encode())+".json"),json.dumps(known).encode())
            _INDEX_WITNESSES[url]=known
        if known["sha256"]!=expected: raise ValueError("official mirror index differs from selected immutable index")
        return {k:known[k] for k in ["url","availableAt","sha256","bytes"]}

def acquire(root,url,offset=None,length=None,index_sha256=None):
    key=sha(json.dumps([url,offset,length]).encode())
    receipt=root/"receipts"/(key+".json")
    if receipt.exists():
        r=json.loads(receipt.read_text()); b=(root/"raw"/r["sha256"]).read_bytes()
        if sha(b)!=r["sha256"] or len(b)!=r["bytes"]: raise ValueError("immutable field archive mismatch")
        if index_sha256 and r.get("indexSha256") and r["indexSha256"]!=index_sha256: raise ValueError("cached field belongs to a different immutable index")
        if offset is None: _INDEX_WITNESSES[r["url"]]=r
        return b,r
    urls=[url]+[base+url[len(BASE):] for base in MIRRORS] if url.startswith(BASE) else [url]
    failures=[]
    for actual in urls:
        try:
            witness=transport_index(root,actual.rsplit(".",1)[0]+".index",index_sha256) if offset is not None and index_sha256 else None
            b,r=fetch_resource(actual,offset,length)
            r.update(requestedUrl=url,transportAttempts=failures)
            if witness:r.update(indexSha256=index_sha256,indexVerification=witness)
            break
        except urllib.error.HTTPError as e:
            if e.code not in TRANSIENT_HTTP:raise
            failures.append({"url":actual,"status":e.code,"receivedAt":stamp(),"retryAfter":e.headers.get("Retry-After") if e.headers else None})
            if actual==urls[-1]:raise
    v=os.statvfs(root)
    if v.f_bavail*v.f_frsize<len(b)+RESERVE: raise OSError("512MiB operating reserve required before evidence write")
    retain(root/"raw"/r["sha256"],b); retain(receipt,json.dumps(r).encode())
    r=json.loads(receipt.read_text());b=(root/"raw"/r["sha256"]).read_bytes()
    if offset is None:_INDEX_WITNESSES[r["url"]]=r
    return b,r

def bilinear(points,lat,lon):
    # Wrapped longitude offsets make the same operator work across the date line.
    rows=[{**p,"dx":(p["lon"]-lon+180)%360-180,"dy":p["lat"]-lat} for p in points]
    xs=sorted(set(round(p["dx"],10) for p in rows)); ys=sorted(set(round(p["dy"],10) for p in rows))
    if len(xs)!=2 or len(ys)!=2 or len({(p["dx"],p["dy"]) for p in rows})!=4 or not(xs[0]-1e-8<=0<=xs[1]+1e-8 and ys[0]-1e-8<=0<=ys[1]+1e-8): raise ValueError("four bracketing grid corners required")
    for p in rows:
        if not math.isfinite(p["value"]) or not 170<=p["value"]<=340: raise ValueError("missing or implausible grid air temperature")
        p["weight"]=(xs[1] if abs(p["dx"]-xs[0])<1e-8 else -xs[0])/(xs[1]-xs[0])*(ys[1] if abs(p["dy"]-ys[0])<1e-8 else -ys[0])/(ys[1]-ys[0])
    if abs(sum(p["weight"] for p in rows)-1)>1e-7: raise ValueError("grid projection weights do not sum to one")
    return sum(p["value"]*p["weight"] for p in rows),rows

def decode(b,record,run,valid,stations):
    if b[:4]!=b"GRIB" or b[7]!=2 or int.from_bytes(b[8:16],"big")!=len(b) or b[-4:]!=b"7777": raise ValueError("single complete GRIB2 message required")
    g=eccodes.codes_new_from_message(b)
    try:
        keys=["shortName","units","typeOfLevel","level","dataDate","dataTime","stepRange","stepUnits","validityDate","validityTime","dataType","number","class","model","gridType","Ni","Nj","latitudeOfFirstGridPointInDegrees","longitudeOfFirstGridPointInDegrees","iDirectionIncrementInDegrees","jDirectionIncrementInDegrees","iScansNegatively","jScansPositively","jPointsAreConsecutive","alternativeRowScanning"]
        m={k:eccodes.codes_get(g,k) for k in keys}
        expected={"shortName":"2t","units":"K","typeOfLevel":"heightAboveGround","level":2,"dataDate":int(run.strftime("%Y%m%d")),"dataTime":run.hour*100,"stepRange":str(record["step"]),"stepUnits":1,"validityDate":int(valid.strftime("%Y%m%d")),"validityTime":valid.hour*100,"dataType":record["type"],"number":record["member"],"class":"ai","model":"aifs-ens","gridType":"regular_ll","Ni":1440,"Nj":721,"latitudeOfFirstGridPointInDegrees":90.0,"iDirectionIncrementInDegrees":0.25,"jDirectionIncrementInDegrees":0.25,"iScansNegatively":0,"jScansPositively":0,"jPointsAreConsecutive":0,"alternativeRowScanning":0}
        if any(str(m[k])!=str(v) for k,v in expected.items()): raise ValueError(f"GRIB metadata differs from indexed forecast: {m}")
        # The encoded scan defines the categorical carrier. Decode its values once,
        # rather than rebuilding a million-point nearest-neighbour search for each site.
        corners_by_station={};indices=[]
        for station in stations:
            lat,lon=station["latitude"],station["longitude"]
            j=math.floor((m["latitudeOfFirstGridPointInDegrees"]-lat)/.25)
            i=math.floor(((lon-m["longitudeOfFirstGridPointInDegrees"])%360)/.25)
            points=[]
            for jj,ii in [(j,i),(j,(i+1)%1440),(j+1,i),(j+1,(i+1)%1440)]:
                if not 0<=jj<721: raise ValueError("station is outside bracketing latitude grid")
                y=90-jj*.25;x=(m["longitudeOfFirstGridPointInDegrees"]+ii*.25+180)%360-180
                dy=math.radians(y-lat);dx=math.radians((x-lon+180)%360-180)
                a=math.sin(dy/2)**2+math.cos(math.radians(lat))*math.cos(math.radians(y))*math.sin(dx/2)**2
                index=jj*1440+ii;indices.append(index)
                points.append({"lat":y,"lon":x,"distance":6371.229*2*math.asin(math.sqrt(min(1,max(0,a)))),"index":index})
            corners_by_station[station["station"]]=points
        values=eccodes.codes_get_double_elements(g,"values",indices);projected={};position=0
        for station in stations:
            points=corners_by_station[station["station"]]
            for point in points:point["value"]=float(values[position]);position+=1
            value,corners=bilinear(points,station["latitude"],station["longitude"])
            projected[station["station"]]={"temperatureF":(value-273.15)*9/5+32,"corners":corners}
        return m,projected
    finally: eccodes.codes_release(g)

def decode_cached(root,b,record,run,valid,stations):
    paths={};projected={};metadata=None;missing=[];field_sha256=sha(b)
    for station in stations:
        key=sha(json.dumps({"field":field_sha256,"run":str(run),"valid":str(valid),"member":record["member"],"type":record["type"],"station":station["station"],"lat":station["latitude"],"lon":station["longitude"],"operator":"bilinear-v1","decoder":eccodes.codes_get_api_version()},sort_keys=True).encode())
        path=root/"projections"/(key+".json");paths[station["station"]]=path
        if path.exists():
            cached=json.loads(path.read_text());metadata=cached["metadata"];projected[station["station"]]=cached["projection"]
        else: missing.append(station)
    if missing:
        metadata,new=decode(b,record,run,valid,missing);projected.update(new)
        for station,projection in new.items():retain(paths[station],json.dumps({"metadata":metadata,"projection":projection},allow_nan=False).encode())
    return metadata,projected

def acquired_records(pool,records,download):
    # Keep three admitted field tasks, rather than materializing every member's
    # bytes in completed futures while projection consumes the ensemble in order.
    records=iter(records);pending=deque()
    for _ in range(3):
        try: record=next(records)
        except StopIteration: break
        pending.append(pool.submit(download,record))
    while pending:
        future=pending.popleft();result=future.result();del future
        yield result
        del result
        try: record=next(records)
        except StopIteration: continue
        pending.append(pool.submit(download,record))

def assemble(root,run,records,indices,valids,options):
    need=sum(r["length"] for r in records)
    missing_bytes=0
    for r in records:
        cachekey=sha(json.dumps([r["url"],r["offset"],r["length"]]).encode())
        if not (root/"receipts"/(cachekey+".json")).exists(): missing_bytes+=r["length"]
    v=os.statvfs(root)
    if v.f_bavail*v.f_frsize<missing_bytes+(RESERVE if missing_bytes else 128*1024*1024): raise OSError("insufficient writable capacity for lossless fields plus 512MiB operating reserve")
    def download(r):
        b,receipt=acquire(root,r["url"],r["offset"],r["length"],r["indexSha256"])
        return r,b,receipt
    fields=[];rows={s["station"]:{v.isoformat().replace("+00:00","Z"):[] for v in valids} for s in options["stations"]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for record,b,receipt in acquired_records(pool,records,download):
            valid=dt.datetime.fromisoformat(record["validTime"].replace("Z","+00:00"))
            metadata,projected=decode_cached(root,b,record,run,valid,options["stations"])
            fields.append({**receipt,"member":record["member"],"validTime":record["validTime"],"indexSha256":record["indexSha256"],"metadata":metadata})
            for station,p in projected.items(): rows[station][record["validTime"]].append({"member":record["member"],"fieldSha256":receipt["sha256"],**p})
    return {"runtime":run.isoformat().replace("+00:00","Z"),"availableAt":max(r["availableAt"] for r in [*fields,*indices]),"collectedAt":stamp(),"source":"ECMWF AIFS ENS v2 open data; CC-BY-4.0 and ECMWF Terms of Use","sourceUrl":"https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data","decoder":eccodes.codes_get_api_version(),"members":list(range(51)),"indices":indices,"fields":fields,"stations":{s:{"rows":[{"validTime":v,"members":sorted(ms,key=lambda r:r["member"])} for v,ms in vs.items()]} for s,vs in rows.items()},"retainedFieldBytes":need,"uncachedFieldBytesAtStart":missing_bytes,"projection":"bilinear 0.25-degree 2m air-temperature grid to verified station coordinates; station representativeness and calibration unmeasured; no time interpolation or daily extrema","tradeEligible":False}

def collect(options):
    root=pathlib.Path(options["cacheDir"]);root.mkdir(parents=True,exist_ok=True)
    v=os.statvfs(root)
    if v.f_bavail*v.f_frsize<128*1024*1024: raise OSError("128MiB operating reserve required to reuse archived ensemble fields")
    now=dt.datetime.fromisoformat(options["now"].replace("Z","+00:00"));count=options.get("validCount",1)
    valid0=dt.datetime.fromtimestamp(math.ceil((now.timestamp()+300)/21600)*21600,UTC)
    valids=[valid0+dt.timedelta(hours=6*i) for i in range(count)]
    cycle=dt.datetime.fromtimestamp(math.floor(now.timestamp()/21600)*21600,UTC);attempts=[];selected=None
    for age in range(3):
        run=cycle-dt.timedelta(hours=6*age)
        if (now-run).total_seconds()>12*3600: continue
        records=[];indices=[]
        try:
            for valid in valids:
                step=int((valid-run).total_seconds()/3600)
                for typ in ["cf","pf"]:
                    key=f"{run:%Y%m%d}/{run:%Hz}/aifs-ens/0p25/enfo/{run:%Y%m%d%H}0000-{step}h-enfo-{typ}"
                    b,receipt=acquire(root,BASE+key+".index");indices.append({**receipt,"rawSource":b.decode(),"validTime":valid.isoformat().replace("+00:00","Z")})
                    selected_rows=[]
                    for line in b.decode().splitlines():
                        r=json.loads(line)
                        if r.get("param")!="2t" or r.get("levtype")!="sfc": continue
                        if r.get("class")!="ai" or r.get("model")!="aifs-ens" or r.get("type")!=typ or int(r["date"])!=int(run.strftime("%Y%m%d")) or int(r["time"])!=run.hour*100 or int(r["step"])!=step: raise ValueError("source index metadata mismatch")
                        member=0 if typ=="cf" else int(r["number"])
                        offset,length=int(r["_offset"]),int(r["_length"])
                        if offset<0 or not 10000<=length<=2_000_000: raise ValueError("field range exceeds resource bound")
                        selected_rows.append({**r,"member":member,"step":step,"offset":offset,"length":length,"url":BASE+key+".grib2","validTime":valid.isoformat().replace("+00:00","Z"),"indexSha256":receipt["sha256"]})
                    expected=[0] if typ=="cf" else list(range(1,51))
                    if sorted(r["member"] for r in selected_rows)!=expected: raise ValueError("complete 51-member ensemble required")
                    records.extend(selected_rows)
            result=assemble(root,run,records,indices,valids,options);result["availabilityAttempts"]=attempts;return result
        except urllib.error.HTTPError as e:
            if e.code not in TRANSIENT_HTTP: raise
            attempts.append({"runtime":run.isoformat(),"status":e.code,"receivedAt":stamp(),"retryAfter":e.headers.get("Retry-After") if e.headers else None})
    if selected is None: raise ValueError("no actually available complete AIFS ENS cycle within 12h")
if __name__=="__main__":
    try: print(json.dumps(collect(json.load(sys.stdin)),allow_nan=False))
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
