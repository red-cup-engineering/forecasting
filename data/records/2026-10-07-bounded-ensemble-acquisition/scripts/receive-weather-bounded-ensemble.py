import pathlib,sys,types,importlib.util,concurrent.futures,threading,time,json
r=pathlib.Path(pathlib.Path('/tmp/weather-bounded-ensemble-record').read_text().strip());sys.modules['eccodes']=types.SimpleNamespace(codes_get_api_version=lambda:'controlled-version');spec=importlib.util.spec_from_file_location('candidate',r/'weather-ecmwf-decode.candidate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
first=threading.Event();later=threading.Event();lock=threading.Lock();started=[];finished=[];result=[];errors=[]
def download(i):
 with lock:started.append(i)
 if i==0:first.wait(5)
 else:
  with lock:
   finished.append(i)
   if len(finished)==2:later.set()
 return (i,bytes([i]),{'id':i})
def receive():
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:result.extend(m.acquired_records(pool,range(51),download))
 except Exception as e:errors.append(str(e))
t=threading.Thread(target=receive);t.start();assert later.wait(3);time.sleep(.05)
with lock:assert sorted(started)==[0,1,2],started
first.set();t.join(5);assert not t.is_alive();assert not errors;assert [v[0] for v in result]==list(range(51));assert [v[1] for v in result]==[bytes([i]) for i in range(51)]
failed=[]
def bad(i):
 failed.append(i)
 if i==2:raise RuntimeError('controlled field failure')
 return i
values=[]
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for x in m.acquired_records(pool,range(51),bad):values.append(x)
except RuntimeError as e:assert str(e)=='controlled field failure'
else:raise AssertionError('failed field was accepted')
assert values==[0,1];assert len(failed)<=5,failed
out={'status':'passed','slowFirstFieldDidNotAdmitRemaining48':True,'outOfOrderCompletionPreserves51MemberOrder':True,'originalFieldBytesAndReceiptsPreserved':True,'fieldFailureNotAccepted':True,'failedSourceTasksStarted':len(failed),'ordersPlaced':0};(r/'controlled-receiving.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
