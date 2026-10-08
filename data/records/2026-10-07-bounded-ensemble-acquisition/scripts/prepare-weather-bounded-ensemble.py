from pathlib import Path
import json,hashlib,subprocess,uuid
repo=Path('/home/emsenn/info');f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=f/'data/records/2026-10-07-bounded-ensemble-acquisition';r.mkdir(parents=True,exist_ok=True);(r/'scripts').mkdir(exist_ok=True);Path('/tmp/weather-bounded-ensemble-record').write_text(str(r));changes=[]
p=f/'src/weather-ecmwf-decode.py';before=p.read_text();after=before;replacements=[]
def replace(old,new):
 global after
 assert after.count(old)==1,old[:100];after=after.replace(old,new);replacements.append({'before':old,'after':new})
replace('import eccodes\n','import eccodes\nfrom collections import deque\n')
replace('    paths={};projected={};metadata=None;missing=[]\n','    paths={};projected={};metadata=None;missing=[];field_sha256=sha(b)\n')
replace('{"field":sha(b),"run":str(run)', '{"field":field_sha256,"run":str(run)')
anchor='def assemble(root,run,records,indices,valids,options):\n'
helper='''def acquired_records(pool,records,download):
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

'''
replace(anchor,helper+anchor)
replace('        for record,b,receipt in pool.map(download,records):','        for record,b,receipt in acquired_records(pool,records,download):')
changes.append((p,before,after,replacements))
# Metadata is an input to the spatial operator, and must survive partial evidence.
p=f/'src/weather-evidence.mjs';before=p.read_text();old='guidance,hourlyGuidance,quantiles,lamp,settlement,local,observations,relational,ecmwfEnsemble,errors,\n    acquisition:';new='guidance,hourlyGuidance,quantiles,lamp,settlement,local,observations,stationMetadata,relational,ecmwfEnsemble,errors,\n    acquisition:';assert before.count(old)==1;after=before.replace(old,new);changes.append((p,before,after,[{'before':old,'after':new}]))
clauses=['all-members-sites-retained','bounded-field-residence','exact-operator-preserved','immutable-field-receipts','station-geometry-evidence'];files={};edits=[]
for p,before,after,replacements in changes:
 name=str(p.relative_to(repo));sha=hashlib.sha256(before.encode()).hexdigest();files[name]={'state':'present','sha256':sha};(r/(p.stem+'.before'+p.suffix)).write_text(before);(r/(p.stem+'.candidate'+p.suffix)).write_text(after);edits.append({'operation':'edit','path':name,'inputSha256':sha,'replacements':replacements,'clauses':clauses})
(r/'input-inventory.json').write_text(json.dumps({'kind':'source-patchset-input','version':1,'sourceRoot':str(repo),'files':files,'clauses':clauses},indent=2)+'\n');(r/'source-patchset.json').write_text(json.dumps({'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Retain at most three admitted field tasks during complete ordered ensemble projection; hash each field once and retain the actual station geometry and receipt evidence in partial and complete snapshots.','changes':edits},indent=2)+'\n');(r/'receiving-conditions.json').write_text(json.dumps({'effect':'All 51 members and station projections remain consumable with fewer resident field buffers and no repeated station-wise field hashing.','required':['Original and candidate return the same complete ensemble fields, geometry, member/site/time scenarios and clocks except actual execution completion time.','No more than three field tasks are admitted and input order survives out-of-order completion.','Source failures terminate without accepting a partial or different ensemble.','Field integrity, metadata, projection and archive checks remain unchanged.','Geometry inputs survive frozen source snapshots and the native reader.','Native whole-cycle outcome and memory usage must be observed separately; isolated decoder savings do not establish full-worker reliability.'],'ordersPlaced':0},indent=2)+'\n')
stage=Path('/tmp/weather-bounded-ensemble-stage-'+uuid.uuid4().hex);tool=repo/Path('/tmp/weather-source-patchset-tool').read_text().strip();subprocess.run(['python3',str(tool),str(r/'input-inventory.json'),str(r/'source-patchset.json'),str(stage)],check=True);Path('/tmp/weather-bounded-ensemble-stage').write_text(str(stage));print(json.dumps({'record':str(r),'paths':len(changes),'canonicalChanged':False}))
