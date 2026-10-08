#!/usr/bin/env node
/**
 * Category shadows runner.   LOG-ONLY: public reads (Kalshi market data unsigned, GDPNow, Yahoo ZQ and CL=F, NY Fed EFFR, Deribit DVOL, Coinbase); no orders, no credentials.
 *   node scripts/category-shadows.mjs tick  [--only gdp,fed,nfp,btc,wti]   one pass over the families, would-take rows appended
 *   node scripts/category-shadows.mjs tick --now ISO ...               dry run at a given time (use a scratch CATEGORY_SHADOWS_STATE)
 *   node scripts/category-shadows.mjs grade                           score settled rows, write admission-readout.{json,md}
 * State: ~/.local/state/561-group/settlements/forecasting-service/category-shadows/<family>/YYYY-MM-DD.jsonl (override: CATEGORY_SHADOWS_STATE).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';
import { stateRoot, loadSeen, recordSeen, appendRows, familyDir } from '../src/category-shadows/common.mjs';
import { liveFetchers } from '../src/category-shadows/live-fetchers.mjs';
import { gradeAll, readoutMarkdown } from '../src/category-shadows/grade.mjs';
import * as gdp from '../src/category-shadows/gdp.mjs';
import * as fed from '../src/category-shadows/fed.mjs';
import * as nfp from '../src/category-shadows/nfp.mjs';
import * as btc from '../src/category-shadows/btc.mjs';
import * as wti from '../src/category-shadows/wti.mjs';

const FAMILIES = { gdp, fed, nfp, btc, wti };
const args = process.argv.slice(2); const cmd = args[0];
const onlyArg = args.indexOf('--only'); const only = onlyArg >= 0 ? args[onlyArg + 1].split(',') : Object.keys(FAMILIES);
const root = stateRoot(); familyDir('gdp', root);
const raw = createKalshiClient({ credentials: null }); // public reads only; the signed paths cannot run
// House-polite lane: serialised reads with a minimum gap; a 429 backs off and retries.
let lastCall = 0; let chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paced = (fn) => (...a) => { const run = async () => { for (let i = 0; i < 6; i += 1) { const w = lastCall + 300 - Date.now(); if (w > 0) await sleep(w); lastCall = Date.now(); try { return await fn(...a); } catch (e) { if (e.status !== 429 || i === 5) throw e; await sleep(2000 * (i + 1)); } } return null; }; const p = chain.then(run); chain = p.catch(() => {}); return p; };
const client = { getMarkets: paced(raw.getMarkets), getMarket: paced(raw.getMarket) };

if (cmd === 'tick') {
  const nowArg = args.indexOf('--now'); const now = nowArg >= 0 ? Date.parse(args[nowArg + 1]) : Date.now(); // --now is for dry runs against a scratch CATEGORY_SHADOWS_STATE
  const fetchers = liveFetchers({ root }); const out = [];
  for (const name of only) {
    const fam = FAMILIES[name]; if (!fam) continue;
    try {
      const r = await fam.tick({ client, now, seen: loadSeen(name, root), fetchers });
      appendRows(name, r.rows, now, root); recordSeen(name, r.keys, root);
      const takes = r.rows.filter((x) => x.take);
      out.push({ family: name, status: r.status, event: r.event ?? null, note: r.note ?? null, logged: r.rows.length, takes: takes.length,
        sample: takes.slice(0, 3).map((x) => ({ ticker: x.ticker, take: x.take, price: x.price, depth: x.depth, fee10: x.fee10, refP: x.refP, edge: x.edge })) });
    } catch (e) { out.push({ family: name, status: 'error', note: String(e.message ?? e) }); console.error(new Date(now).toISOString(), name, e.stack ?? e); }
  }
  appendFileSync(join(root, 'ticks.jsonl'), JSON.stringify({ t: new Date(now).toISOString(), families: out }) + '\n');
  console.log(JSON.stringify(out, null, 1));
} else if (cmd === 'grade') {
  const per = await gradeAll({ client, root });
  const at = new Date().toISOString();
  writeFileSync(join(root, 'admission-readout.json'), JSON.stringify({ at, families: per }, null, 1));
  writeFileSync(join(root, 'admission-readout.md'), readoutMarkdown(per, at));
  console.log(readoutMarkdown(per, at));
} else { console.error('usage: category-shadows.mjs tick|grade [--only gdp,fed,nfp,btc,wti]'); process.exit(2); }
