"""Chronological check of the existing rain study; date-clustered uncertainty."""
import csv,json,math,random,statistics,pathlib,hashlib
HERE=pathlib.Path(__file__).resolve().parents[1]
SOURCE=HERE.parent/'2026-10-04-weather-coverage/data/rain-scored.csv'
SPLIT='2026-09-02'
def logit(p):
 p=min(.999,max(.001,p));return math.log(p/(1-p))
def pool(a,b):return 1/(1+math.exp(-(logit(a)+logit(b))/2))
rows=[r for r in csv.DictReader(SOURCE.open()) if r['date']>=SPLIT]
result={'source':str(SOURCE.relative_to(HERE.parent)),'sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'evaluation':'Only dates >= 2026-09-02, predicted by the early-half model; reverse-time fold excluded. Pool selected retrospectively, so not prospective validation.','bootstrap':'10000 resamples of settlement dates, paired daily-mean Brier improvement; fixed seed 561','stages':[]}
for stage in ['D-1 15h','D-1 21h','D 07h']:
 rs=[r for r in rows if r['dec']==stage];days={};scores={k:[] for k in ['weather','market','pool']}
 for r in rs:
  w,m,y=map(float,[r['pm_pany'],r['mid'],r['y']]); q=pool(w,m)
  s={k:(p-y)**2 for k,p in [('weather',w),('market',m),('pool',q)]}
  for k in scores:scores[k].append(s[k])
  days.setdefault(r['date'],[]).append(s['market']-s['pool'])
 diffs=[statistics.mean(v) for v in days.values()];rng=random.Random(561)
 samples=sorted(statistics.mean(rng.choices(diffs,k=len(diffs))) for _ in range(10000))
 result['stages'].append({'stage':stage,'rows':len(rs),'dates':len(days),'rowWeightedBrier':{k:statistics.mean(v) for k,v in scores.items()},'dateWeightedPoolImprovementOverMarket':statistics.mean(diffs),'dateBootstrap95':[samples[250],samples[9750]]})
(HERE/'rain-chronological-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
