#!/usr/bin/env node
// For every cataloged earnings event, find the company's 8-K (item 2.02) accepted BEFORE the call start
// and cache the press-release exhibit text. Public SEC endpoints, descriptive User-Agent, <= 8 req/s.
//   node scripts/earnings-mentions-edgar.mjs [--cache DIR] [--contact EMAIL]
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const cache = opt('cache', '/tmp/claude-1000/-home-emsenn-info/ff528934-809b-45da-8279-b7a50087597e/scratchpad/cache');
const UA = `forecasting-research ${opt('contact', 'morgan.sennhauser@gmail.com')}`;
mkdirSync(join(cache, 'edgar'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url, json = true) {
  for (let a = 0; a < 6; a += 1) {
    const wait = Math.max(0, last + 125 - Date.now()); if (wait) await sleep(wait); last = Date.now();
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } }).catch(() => null);
    if (res?.ok) return json ? res.json() : res.text();
    if (res && res.status !== 429 && res.status !== 503) return null;
    await sleep(2000 * 2 ** a);
  }
  return null;
}
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' ').replace(/&nbsp;|&#160;/gu, ' ').replace(/&amp;/gu, '&').replace(/&#8217;|&rsquo;/gu, "'").replace(/\s+/gu, ' ');

const catalog = JSON.parse(readFileSync(join(cache, 'catalog.json'), 'utf8'));
const tickers = new Map(Object.values(JSON.parse(readFileSync(join(cache, '..', 'sec_tickers.json'), 'utf8'))).map((v) => [v.ticker, v.cik_str]));
const events = new Map();
for (const m of catalog) if (m.callStart && !events.has(m.event)) events.set(m.event, { series: m.series, callStart: m.callStart });
const subs = new Map();
let found = 0; let n = 0;
for (const [event, { series, callStart }] of events) {
  const path = join(cache, 'edgar', `${event}.json`);
  if (existsSync(path)) continue;
  const ticker = series.replace(/^(KXEARNINGSMENTION|KXMENTIONEARN)/u, '');
  const cik = tickers.get(ticker);
  let rec = { event, ticker, cik: cik ?? null, text: null };
  if (cik) {
    if (!subs.has(cik)) {
      const s = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
      let recent = s?.filings?.recent;
      if (recent) { // fold in the older submission pages that overlap the catalog window (cheap: usually none needed)
        for (const f of s.filings.files ?? []) if (Date.parse(f.filingTo) > Date.parse('2025-06-01')) {
          const more = await get(`https://data.sec.gov/submissions/${f.name}`);
          if (more) for (const k of Object.keys(recent)) recent[k] = recent[k].concat(more[k] ?? []);
        }
      }
      subs.set(cik, recent ?? null);
    }
    const r = subs.get(cik);
    if (r) {
      let best = null;
      for (let i = 0; i < r.form.length; i += 1) {
        if (r.form[i] !== '8-K' || !/2\.02/u.test(r.items[i] ?? '')) continue;
        const acc = Date.parse(r.acceptanceDateTime[i]);
        if (acc <= callStart && callStart - acc < 2 * 86400e3 && (!best || acc > best.acc)) best = { acc, no: r.accessionNumber[i], primary: r.primaryDocument[i] };
      }
      if (best) {
        const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${best.no.replace(/-/gu, '')}`;
        const idx = await get(`${base}/index.json`);
        const docs = (idx?.directory?.item ?? []).map((d) => d.name).filter((nm) => /\.(htm|html|txt)$/iu.test(nm));
        const ex = docs.find((nm) => /(ex|exh|pr|press).{0,4}99/iu.test(nm)) ?? docs.find((nm) => /99/u.test(nm)) ?? docs.find((nm) => nm !== best.primary) ?? best.primary;
        const html = ex ? await get(`${base}/${ex}`, false) : null;
        if (html) { rec = { ...rec, accepted: new Date(best.acc).toISOString(), accession: best.no, doc: ex, text: strip(html).slice(0, 400000) }; found += 1; }
      }
    }
  }
  writeFileSync(path, JSON.stringify(rec));
  if (++n % 25 === 0) console.error(`${n}/${events.size} events, ${found} releases`);
}
console.error(`done: ${found} releases`);
