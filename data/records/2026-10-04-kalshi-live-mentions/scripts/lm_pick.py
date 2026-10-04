"""Pick streams per event from cand_*.json: 'fastest' = candidate feed (n_hit>=4) with the largest median(J-u), 'all' = every feed with n_hit>=4."""
import sys, json, glob
CACHE = sys.argv[1]; fast = []; allc = []
for f in sorted(glob.glob(CACHE + '/cand_*.json')):
    d = json.load(open(f)); cs = [c for c in d['cands'] if c['n_hit'] >= 4 and c['med_J_minus_u'] is not None]
    if not cs: continue
    allc += [dict(event=d['event'], vid=c['vid']) for c in cs]
    b = max(cs, key=lambda c: c['med_J_minus_u']); fast.append(dict(event=d['event'], vid=b['vid']))
json.dump(fast, open('results/sets_fastest.json', 'w')); json.dump(allc, open('results/sets_all.json', 'w'))
print(len(fast), 'events', len(allc), 'feeds')
