import json, datetime as dt, openpyxl
D="data/ext/"
d=json.load(open(D+"cf_month.json"))
out={}
for c in d:
    Y,M=map(int,c['chart']['subcaption'].split('-'))
    labs=[x['label'] for x in c['categories'][0]['category']]
    series={s['seriesname']:[x['value'] for x in s['data']] for s in c['dataset']}
    def ds(name): return next(x for x in c['dataset'] if x['seriesname']==name)['data']
    cs,ks,ac,ak=ds('CPI Inflation'),ds('Core CPI Inflation'),ds('Actual CPI Inflation'),ds('Actual Core CPI Inflation')
    recs=[]
    for k,x in enumerate(cs):
        m,dd=map(int,x['tooltext'].split('{br}')[1].split('/'))
        y=Y-1 if m-M>6 else (Y+1 if M-m>6 else Y)
        f=lambda z: float(z['value']) if z['value']!='' else None
        recs.append(dict(date=dt.date(y,m,dd).isoformat(),cpi=f(cs[k]),core=f(ks[k]),acpi=f(ac[k]),acore=f(ak[k])))
    out[f"{Y}-{M:02d}"]=recs
json.dump(out,open("data/ext/cleveland_daily.json","w"))
print(len(out), out['2026-08'][:2], out['2026-08'][-2:])
# GDPNow
wb=openpyxl.load_workbook(D+"gdpnow.xlsx",read_only=True,data_only=True)
g=[]
for sh in ['TrackingDeepArchives','TrackingArchives']:
    rows=list(wb[sh].iter_rows(values_only=True)); h=rows[0]
    ix={n:i for i,n in enumerate(h) if n}
    for r in rows[1:]:
        if r[0] is None or not hasattr(r[0],'isoformat'): continue
        v=r[ix['GDP Nowcast']]
        if not isinstance(v,(int,float)): continue
        adv=r[ix['Advance Estimate From BEA']]; pub=r[ix['Publication Date of Advance Estimate']]
        g.append(dict(date=r[0].date().isoformat(),q=r[1].date().isoformat(),now=v,adv=adv if isinstance(adv,(int,float)) else None,pub=pub.date().isoformat() if hasattr(pub,'isoformat') else None))
json.dump(g,open("data/ext/gdpnow_hist.json","w"))
print(len(g),g[-1])
