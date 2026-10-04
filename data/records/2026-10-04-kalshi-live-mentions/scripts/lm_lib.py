"""Shared: caption words, word matching per Kalshi mention rules, trades, fees."""
import json, re, os, math, datetime as dt, sys
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import kget
CACHE = os.environ.get('LM_CACHE', '/tmp/lm_cache')
os.makedirs(CACHE, exist_ok=True)

def iso(s):  # 'Z' iso -> epoch float
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()

def words_from_json3(path):
    d = json.load(open(path)); out = []
    for e in d['events']:
        base = e.get('tStartMs', 0)
        for s in e.get('segs', []) or []:
            w = s.get('utf8', '').strip()
            if not w or w == '\n': continue
            out.append(((base + s.get('tOffsetMs', 0)) / 1000.0, norm(w)))
    out.sort()
    ded = []; last = {}
    for t, w in out:
        if w in last and t - last[w] < 1.5: continue
        last[w] = t; ded.append((t, w))
    return ded

def norm(w):
    w = w.lower().replace('’', "'")
    return re.sub(r"[^a-z0-9'$%]", '', w)

def variants(strike):
    """'Zohran / Mamdani' -> [['zohran'],['mamdani']] ; 'Great Hall' -> [['great','hall']].
    Kalshi: exact word/phrase, plural or possessive of it counts. Grammatical inflections do not."""
    out = []
    for alt in re.split(r'\s*/\s*', strike):
        alt = re.sub(r'\(.*?\)', '', alt).strip()
        toks = [norm(t) for t in alt.split() if norm(t)]
        if toks: out.append(toks)
    return out

def tok_match(tok, w):
    return w == tok or w in (tok + 's', tok + "'s", tok + 'es', tok + "s'") or (tok.endswith('y') and w == tok[:-1] + 'ies')

def find_utterances(words, strike):
    """list of video-times where any variant occurs."""
    hits = []
    for v in variants(strike):
        n = len(v)
        for i in range(len(words) - n + 1):
            if all(tok_match(v[k], words[i + k][1]) for k in range(n)):
                hits.append(words[i][0])
    hits.sort(); ded = []
    for t in hits:
        if not ded or t - ded[-1] > 3: ded.append(t)
    return ded

def get_trades(ticker):
    p = f'{CACHE}/trades_{ticker}.json'
    if os.path.exists(p): return json.load(open(p))
    tr = []; cur = None
    while True:
        d = kget('/markets/trades', ticker=ticker, limit=1000, cursor=cur)
        if not d: break
        tr += d['trades']; cur = d.get('cursor')
        if not cur or not d['trades']: break
    rows = sorted([(iso(t['created_time']), float(t['yes_price_dollars']), float(t['count_fp']), t['taker_side']) for t in tr])
    json.dump(rows, open(p, 'w')); return rows

def fee(price, n=1):
    """Kalshi quadratic taker fee, ceil to cent on the order: 0.07*C*P*(1-P)."""
    return math.ceil(0.07 * n * price * (1 - price) * 100 - 1e-9) / 100.0

def wilson(k, n, z=1.96):
    if n == 0: return (float('nan'), float('nan'))
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)
