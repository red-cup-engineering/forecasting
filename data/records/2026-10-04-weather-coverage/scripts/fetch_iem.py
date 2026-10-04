"""IEM archive: NBS guidance CSV (all columns) and NWS daily climate (cli.py) for the rain/snow/avg-temp stations. Paced; IEM throttles."""
import urllib.request, time, os, sys
UA = {"user-agent": "561-group weather desk research (ops@561.group)"}
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
STN = sys.argv[1].split(',')
def get(url):
    for i in range(8):
        time.sleep(5)
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180).read()
            if b.startswith(b"Too many"): time.sleep(30 * (i + 1)); continue
            return b
        except Exception as e:
            print('retry', url, e, file=sys.stderr); time.sleep(20 * (i + 1))
    raise RuntimeError(url)
for s in STN:
    p = f'{D}/nbs/{s}.csv'
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        open(p, 'wb').write(get(f'https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py?station={s}&model=NBS&sts=2026-07-24T00:00Z&ets=2026-10-04T18:00Z&format=csv')); print('nbs', s, os.path.getsize(p), flush=True)
    p = f'{D}/cli/{s}.json'
    if not os.path.exists(p):
        open(p, 'wb').write(get(f'https://mesonet.agron.iastate.edu/json/cli.py?station={s}&year=2026')); print('cli', s, flush=True)
