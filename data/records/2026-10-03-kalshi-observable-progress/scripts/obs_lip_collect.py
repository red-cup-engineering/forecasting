#!/usr/bin/env python3
"""Dump all incentive programs (LIP) to OUTDIR/incentives.json. Usage: obs_lip_collect.py OUTDIR"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
rows = list(paged("/incentive_programs", "incentive_programs", limit=1000, status="all"))
json.dump(rows, open(sys.argv[1] + "/incentives.json", "w"))
print(len(rows))
