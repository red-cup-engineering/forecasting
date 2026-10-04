"""GDPNow latest nowcast + trailing RMSE vs advance estimate, from the Atlanta Fed workbook. Prints one JSON line. usage: category-shadows-gdpnow.py XLSX_PATH"""
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
rows = list(wb['TrackingHistory'].iter_rows(values_only=True))
dates = rows[0]; label = next(r for r in rows if r[0] == 'GDP' and r[1] == 'GDP Nowcast')
last = max((i for i, v in enumerate(label) if i > 1 and isinstance(v, (int, float)) and hasattr(dates[i], 'isoformat')), key=lambda i: dates[i])
quarter = str(rows[1][0]).replace('Evolution of GDP nowcast and components for ', '')
hist = {}
for sh in ('TrackingDeepArchives', 'TrackingArchives'):
    r = list(wb[sh].iter_rows(values_only=True)); ix = {n: i for i, n in enumerate(r[0]) if n}
    for x in r[1:]:
        if not hasattr(x[0], 'isoformat'): continue
        v = x[ix['GDP Nowcast']]; adv = x[ix['Advance Estimate From BEA']]; pub = x[ix['Publication Date of Advance Estimate']]
        if isinstance(v, (int, float)) and isinstance(adv, (int, float)) and hasattr(pub, 'isoformat') and x[0] < pub:
            q = x[1].date().isoformat(); cur = hist.get(q)
            if cur is None or x[0] > cur[0]: hist[q] = (x[0], v, adv)
errs = [h[2] - h[1] for _, h in sorted(hist.items())][-60:]
rmse = (sum(e * e for e in errs) / len(errs)) ** 0.5 if len(errs) >= 8 else 1.16
print(json.dumps(dict(date=dates[last].date().isoformat(), nowcast=float(label[last]), quarter=quarter, sd=round(rmse, 4), nQuarters=len(errs))))
