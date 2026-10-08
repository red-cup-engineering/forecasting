import importlib.util,pathlib,math,json,sys
sys.dont_write_bytecode=True
f=pathlib.Path(__file__).resolve().parents[4];spec=importlib.util.spec_from_file_location('decode',f/'src/weather-ecmwf-decode.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for lat,lon in [(40.6398,-73.7789),(0,179.99),(0,180),(0,0)]:
 y0=math.floor(lat*4)/4;x0=math.floor(lon*4)/4
 corners=[{'lat':y,'lon':x,'value':280+2*(y-lat)+3*((x-lon+180)%360-180),'distance':1,'index':i} for i,(y,x) in enumerate([(y0,x0),(y0,x0+.25),(y0+.25,x0),(y0+.25,x0+.25)])]
 v,c=m.bilinear(corners,lat,lon);assert abs(v-280)<1e-8;assert abs(sum(p['weight'] for p in c)-1)<1e-8;assert all(p['weight']>=-1e-10 for p in c)
b=pathlib.Path(__import__('sys').argv[1]).read_bytes();run=m.dt.datetime(2026,10,7,6,tzinfo=m.UTC);valid=run+m.dt.timedelta(hours=12)
metadata,p=m.decode(b,{'step':12,'type':'pf','member':35},run,valid,[{'station':'KJFK','latitude':40.6398,'longitude':-73.7789}]);assert 50<p['KJFK']['temperatureF']<80
try:m.decode(b,{'step':12,'type':'pf','member':34},run,valid,[]);raise AssertionError('wrong member accepted')
except ValueError:pass
print(json.dumps({'affineProjection':True,'datelineProjection':True,'boundaryProjection':True,'actualGribDecoded':metadata,'wrongMemberRefused':True,'jfkProjection':p}))
