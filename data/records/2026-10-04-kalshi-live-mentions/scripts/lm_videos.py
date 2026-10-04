"""For each settled mention event, search YouTube for the archived live stream, pull auto-captions (word timed)
+ info json, score the candidate by how many YES markets show a price jump that lines up with a caption hit.
usage: lm_videos.py YT_DLP CACHE_DIR EVENT... (needs results/events.json)"""
import sys, json, os, re, subprocess
sys.path.insert(0, os.path.dirname(__file__))
YT, CACHE = sys.argv[1], sys.argv[2]; os.environ['LM_CACHE'] = CACHE
import lm_lib as L
evs = {e['event']: e for e in json.load(open('results/events.json'))}
def run(cmd, t=150):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=t).stdout
    except Exception as x: return ''
def strike(m):
    c = m['custom_strike']; return c.get('Word') if isinstance(c, dict) else str(c)
def jump(tr):
    # first trade >=0.90 after any trade <0.80 ; else None
    seen_low = False
    for t, p, c, s in tr:
        if p < 0.80: seen_low = True
        elif p >= 0.90 and seen_low: return t
    return None
for et in sys.argv[3:]:
    e = evs[et]; out = f'{CACHE}/cand_{et}.json'
    if os.path.exists(out): continue
    name = re.search(r'as part of (.*?)(?: originally| on [A-Z]|, then)', e['title'] + ', then')
    name = (name.group(1) if name else e['title'][-80:]).strip()
    day = e['close'][:10]
    who = {'KXVANCEMENTION': 'Vance', 'KXLEAVITTMENTION': 'Leavitt', 'KXFEDMENTION': 'Powell'}.get(e['series'], 'Trump')
    q = f"ytsearch8:{who} {name} live"
    r = run([YT, '--flat-playlist', '-J', q], 90)
    try: ents = json.loads(r)['entries']
    except Exception: ents = []
    yes = [m for m in e['markets'] if m['result'] == 'yes' and float(m['volume_fp'] or 0) > 300]
    trs = {m['ticker']: L.get_trades(m['ticker']) for m in yes[:25]}
    res = []
    for en in ents:
        if not en.get('duration') or en['duration'] < 600: continue
        vid = en['id']; d = f'{CACHE}/v_{vid}'
        if not os.path.exists(d + '.info.json') or not os.path.exists(d + '.en.json3'):
            run([YT, '--skip-download', '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'json3', '--write-info-json', '-o', d, f'https://www.youtube.com/watch?v={vid}'], 150)
        if not (os.path.exists(d + '.info.json') and os.path.exists(d + '.en.json3')): continue
        info = json.load(open(d + '.info.json')); rel = info.get('release_timestamp')
        words = L.words_from_json3(d + '.en.json3')
        n = 0; hits = 0; diffs = []
        for m in yes[:25]:
            tr = trs[m['ticker']]; J = jump(tr)
            if J is None or rel is None: continue
            n += 1
            u = L.find_utterances(words, strike(m))
            near = [J - (rel + x) for x in u if -60 < J - (rel + x) < 60]
            if near:
                hits += 1; diffs.append(min(near, key=abs))
        diffs.sort()
        res.append(dict(vid=vid, title=en.get('title'), channel=en.get('channel'), dur=en['duration'], rel=rel, live=info.get('live_status'), n_jump=n, n_hit=hits, med_J_minus_u=diffs[len(diffs)//2] if diffs else None, iqr=[diffs[len(diffs)//4], diffs[3*len(diffs)//4]] if len(diffs) > 3 else None))
    json.dump(dict(event=et, query=q, cands=res), open(out, 'w'))
    best = max(res, key=lambda r: r['n_hit'], default=None)
    print(et, 'jumpable', best and best['n_jump'], 'best', best and (best['vid'], best['n_hit'], best['med_J_minus_u'], best['iqr'], best['live'], best['channel']), flush=True)
