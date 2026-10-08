#!/usr/bin/env node
/**
 * The hypothesis program's command line. Public GETs only; nothing here can place an order.
 *
 *   node scripts/hypotheses.mjs run --budget N [--mode all|sync|collect|verdict] [--only id,id]
 *   node scripts/hypotheses.mjs status
 *   node scripts/hypotheses.mjs verdict <id>
 *
 * The request budget is the caller's: --budget or HYPOTHESES_REQUEST_BUDGET. State: HYPOTHESES_STATE_DIR or
 * ~/.local/state/561-group/settlements/forecasting-service/hypotheses/.
 */
import { pathToFileURL } from 'node:url';
import { hypothesesDir, loadHypotheses, readStatuses, runHypotheses } from '../src/hypotheses/run.mjs';

const args = process.argv.slice(2), cmd = args[0];
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? 'inf' : x === -Infinity ? '-inf' : 'n/a');

function table(rows) {
  const head = ['id', 'status', 'reading', 'clusters', 'mean net', 't', 'note'];
  const lines = rows.map((r) => [r.id, r.status, r.reading ?? '-', r.status === 'killed' ? '-' : `${r.clusters ?? 0}/${r.minClusters ?? '?'}`, f(r.mean), f(r.t, 2), r.status === 'killed' ? (r.killed?.reason ?? '').slice(0, 60) : (r.awaiting ? `awaiting ${r.awaiting}` : (r.reasons ?? []).join('; ')).slice(0, 70)]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  return [head, ...lines].map((l) => l.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd()).join('\n');
}

export async function main() {
  if (cmd === 'run') {
    const requestBudget = Number(opt('budget') ?? process.env.HYPOTHESES_REQUEST_BUDGET);
    if (!Number.isInteger(requestBudget) && opt('mode') !== 'verdict') { console.error('run needs --budget N (or HYPOTHESES_REQUEST_BUDGET)'); process.exit(2); }
    const r = await runHypotheses({ requestBudget, mode: opt('mode') ?? 'all', only: opt('only')?.split(',') ?? null });
    console.log(`sync: ${r.sync ? `${r.sync.requests}/${r.sync.budget} requests, ${r.sync.newMarkets ?? 0} new markets, ${r.sync.newQuotes ?? 0} new quotes, ${r.sync.newEntries ?? 0} new live entries${r.partial ? ' (budget exhausted: partial)' : ''}` : 'none (verdict mode)'}`);
    console.log(table(r.hypotheses));
  } else if (cmd === 'status') {
    console.log(table(readStatuses()));
  } else if (cmd === 'verdict' && args[1]) {
    const h = loadHypotheses(hypothesesDir).find((x) => x.id === args[1]);
    if (!h) { console.error(`unknown hypothesis ${args[1]}`); process.exit(2); }
    const r = (await runHypotheses({ mode: 'verdict', only: [h.id] })).hypotheses[0];
    console.log(JSON.stringify(r, null, 2));
  } else { console.error('usage: hypotheses.mjs run --budget N | status | verdict <id>'); process.exit(2); }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
