"""Market classes and series for the belief-path laboratory."""
import json, os
CITIES = ["NY", "CHI", "MIA", "AUS", "LAX", "DEN", "PHIL"]
CLASSES = {
  "weather": dict(series=[f"KXHIGH{c}" for c in CITIES] + [f"KXLOWT{c}" for c in CITIES], days=9, win_h=36),
  "gas": dict(series=["KXAAAGASD", "KXAAAGASDCA", "KXAAAGASDAZ", "KXAAAGASDPA", "KXAAAGASDNC", "KXAAAGASDGA"], days=9, win_h=36),
  "sports_game": dict(series=["KXNFLGAME","KXNCAAFGAME","KXMLBGAME","KXWNBAGAME","KXNHLGAME","KXNBAGAME","KXEPLGAME","KXUCLGAME","KXLALIGAGAME","KXBUNDESLIGAGAME","KXSERIEAGAME","KXLIGUE1GAME","KXMLSGAME","KXATPMATCH","KXWTAMATCH"], days=8, win_h=8),
  "sports_prop": dict(series=["KXNFLPASSYDS","KXNFLRECYDS","KXNFLRUSHYDS","KXNFLANYTD","KXMLBHIT","KXMLBKS","KXMLBHRR","KXNBAPTS","KXNBA3PT","KXNHLPTS","KXNHLGOAL","KXMLBHR"], days=8, win_h=8),
  "mentions": dict(series="@MENTIONS", days=14, win_h=24),
  "econ": dict(series=["KXCPI","KXCPIYOY","KXCPICOREYOY","KXECONSTATCPI","KXECONSTATCPIYOY","KXECONSTATCPICORE","KXECONSTATU3","KXJOBLESSCLAIMS","KXPAYROLLSREV","KXFEDDECISION","KXGDP","KXCPIGAS","KXEFFR","KXTRUFGAS"], days=35, win_h=48),
  "crypto": dict(series=["KXBTCD","KXBTC","KXETHD","KXETH","KXSOLD","KXXRPD","KXDOGE","KXBTC15M","KXETH15M"], days=4, win_h=6),
}
def series_for(cls, lab_data):
    s = CLASSES[cls]["series"]
    if s == "@MENTIONS":
        cat = json.load(open(os.path.join(lab_data, "series-all.json")))
        return [r[1] for r in cat if r[0] == "Mentions"]
    return s
