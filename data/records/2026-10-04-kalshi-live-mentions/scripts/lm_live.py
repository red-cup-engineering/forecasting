"""Live shadow monitor: attach to a live YouTube stream, run streaming ASR (faster-whisper tiny/base, CPU, int8),
match the active Kalshi mention markets of one event, and record would-buy decisions with Kalshi quotes.
NO orders, NO keys: public Kalshi endpoints only. Needs yt-dlp + ffmpeg + faster-whisper (venv).
usage: lm_live.py --event KXTRUMPMENTION-26OCT03 --url https://www.youtube.com/watch?v=ID --out results/live/<event>.jsonl
       [--yt yt-dlp] [--model tiny.en] [--minutes 120] [--max-ask 0.95] [--size 100]"""
import argparse, json, os, subprocess, sys, threading, time, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import lm_lib as L
from kalshi_obs_lib import kget
ap = argparse.ArgumentParser()
ap.add_argument('--event', required=True); ap.add_argument('--url', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--yt', default='yt-dlp'); ap.add_argument('--model', default='tiny.en'); ap.add_argument('--minutes', type=float, default=120)
ap.add_argument('--max-ask', type=float, default=0.95); ap.add_argument('--size', type=int, default=100)
ap.add_argument('--words', help='self-test: comma list of words, no Kalshi quotes (mock markets)')
ap.add_argument('--debug', action='store_true')
ap.add_argument('--win', type=float, default=8.0); ap.add_argument('--step', type=float, default=2.5)
a = ap.parse_args()
os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
lock = threading.Lock(); fh = open(a.out, 'a')
def log(**r):
    r['ts'] = time.time()
    with lock: fh.write(json.dumps(r) + '\n'); fh.flush()

def strike(m):
    c = m.get('custom_strike'); return c.get('Word') if isinstance(c, dict) else str(c)
def load_markets():
    d = kget('/markets', event_ticker=a.event, limit=200)
    out = []
    for m in (d or {}).get('markets', []):
        if m['status'] not in ('active', 'open'): continue
        s = strike(m)
        if re.search(r'\(\d+\+', s): continue   # count markets ("Iran (5+ times)") need counting, not first-hit: skipped
        out.append(dict(ticker=m['ticker'], word=s, ask0=float(m['yes_ask_dollars']), bid0=float(m['yes_bid_dollars'])))
    return out
import re
markets = [dict(ticker='TEST-' + w, word=w, ask0=float('nan'), bid0=float('nan')) for w in a.words.split(',')] if a.words else load_markets()
log(kind='start', event=a.event, url=a.url, model=a.model, n_markets=len(markets), words=[m['word'] for m in markets])
said = {}   # ticker -> detection wall time

def quote(t):
    if t.startswith('TEST-'): return dict(bid=float('nan'), ask=float('nan'), last=float('nan'), ts=time.time())
    d = kget('/markets/' + t)
    m = (d or {}).get('market') or {}
    return dict(bid=float(m.get('yes_bid_dollars', 'nan')), ask=float(m.get('yes_ask_dollars', 'nan')), last=float(m.get('last_price_dollars', 'nan')), ts=time.time())
def followups(mk, t_det):
    for dt_ in (5, 15, 30, 60):
        time.sleep(max(0, t_det + dt_ - time.time()))
        q = quote(mk['ticker']); log(kind='followup', ticker=mk['ticker'], word=mk['word'], plus=dt_, **{'q_' + k: v for k, v in q.items()})

# audio
u = subprocess.run([a.yt, '-g', '-f', '234/233/bestaudio/best', a.url], capture_output=True, text=True, timeout=90).stdout.split()[0]
ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-live_start_index', '-1', '-i', u, '-vn', '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], stdout=subprocess.PIPE)
from faster_whisper import WhisperModel
model = WhisperModel(a.model, device='cpu', compute_type='int8', cpu_threads=2)
SR = 16000; BUF = {'a': np.zeros(0, dtype=np.float32), 't': time.time(), 'eof': False}
def reader():   # separate thread so ASR time never backs up the pipe; t = arrival wall time of the newest sample
    while True:
        raw = ff.stdout.read(SR * 4 // 2)   # 0.5 s chunks (float32)
        if not raw: BUF['eof'] = True; return
        x = np.frombuffer(raw[:len(raw) // 4 * 4], dtype=np.float32)
        BUF['a'] = np.concatenate([BUF['a'], x])[-int(SR * a.win):]; BUF['t'] = time.time()
threading.Thread(target=reader, daemon=True).start()
t_end = time.time() + a.minutes * 60; last_t = 0
while time.time() < t_end and not BUF['eof']:
    time.sleep(0.2)
    if BUF['t'] == last_t or len(BUF['a']) < SR * 3: continue
    buf, end_wall = BUF['a'].copy(), BUF['t']; last_t = end_wall
    t0 = time.time()
    segs, _ = model.transcribe(buf, language='en', beam_size=1, word_timestamps=True, condition_on_previous_text=False, vad_filter=False)
    words = [(end_wall - len(buf) / SR + w.start, L.norm(w.word)) for s in segs for w in s.words]
    asr_s = time.time() - t0
    if a.debug: log(kind='asr', asr_s=round(asr_s, 2), lag_s=round(time.time() - end_wall, 2), text=' '.join(w for _, w in words))
    for mk in markets:
        if mk['ticker'] in said: continue
        hit = L.find_utterances(words, mk['word'])
        if not hit: continue
        t_word = hit[0]; t_det = time.time()
        said[mk['ticker']] = t_det
        q = quote(mk['ticker'])
        ok = bool(q['ask'] <= a.max_ask)
        log(kind='detect', ticker=mk['ticker'], word=mk['word'], t_word_wall=t_word, t_detect=t_det, lat_s=round(t_det - t_word, 2), asr_s=round(asr_s, 2),
            ask=q['ask'], bid=q['bid'], last=q['last'], ask_pre=mk['ask0'], would_buy=ok, size=a.size,
            fee=L.fee(q['ask'], a.size) if ok else None, ctx=' '.join(w for _, w in words[-12:]))
        threading.Thread(target=followups, args=(mk, t_det), daemon=True).start()
    if asr_s > a.step * 2: log(kind='slow', asr_s=round(asr_s, 2))
log(kind='stop', detected=len(said))
time.sleep(65)
