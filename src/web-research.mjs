/**
 * Keyless web evidence for the forecasting bot: Google News RSS (headlines, date-filterable with after:/before:),
 * GDELT DOC 2.0 (real article URLs, date-filterable, one request per 5 s), and plain page fetch. Every request
 * carries an honest User-Agent naming the operator. No paid search API is used or needed; the house holds none.
 *
 * `asOf` makes a search point-in-time for backtests: it appends before:<asOf> to the news query and bounds GDELT's
 * enddatetime. That is best-effort only (search indices re-rank and sometimes surface later-edited pages), so the
 * backtest reports the retrieval arm separately from the no-retrieval arm.
 */

export const USER_AGENT = "561-group-forecasting-bot/0.1 (research reader; contact via https://561.group)";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/gu, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n)));
const stripTags = (s) => decode(s.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
const day = (d) => new Date(d).toISOString().slice(0, 10);

let lastGdelt = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { fetchImpl = globalThis.fetch, accept = "*/*", timeoutMs = 20_000 } = {}) {
  const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!response.ok) throw new Error(`web-research: ${response.status} ${new URL(url).host}`);
  return response;
}

/** Google News RSS search -> [{title, source, link, publishedAt}]. */
export async function searchGoogleNews(query, { after = null, before = null, limit = 8, fetchImpl } = {}) {
  const q = [query, after ? `after:${day(after)}` : "", before ? `before:${day(before)}` : ""].filter(Boolean).join(" ");
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await (await get(url, { fetchImpl, accept: "application/rss+xml" })).text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
    const block = m[1];
    const tag = (t) => (block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "u")) ?? [])[1] ?? "";
    const rawTitle = stripTags(tag("title"));
    const source = stripTags(tag("source"));
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const published = Date.parse(tag("pubDate"));
    items.push({ origin: "google-news", title, source, link: stripTags(tag("link")), publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null });
    if (items.length >= limit) break;
  }
  return items;
}

/** GDELT DOC 2.0 article list -> [{title, source, link, publishedAt}]. Honors GDELT's one-request-per-5-seconds rule. */
export async function searchGdelt(query, { after = null, before = null, limit = 6, fetchImpl } = {}) {
  const gap = lastGdelt + 5200 - Date.now();
  if (gap > 0) await wait(gap);
  lastGdelt = Date.now();
  const stamp = (d) => new Date(d).toISOString().replace(/[-:T]/gu, "").slice(0, 14);
  const params = new URLSearchParams({ query, mode: "artlist", maxrecords: String(limit), format: "json", sort: "hybridrel" });
  if (after) params.set("startdatetime", stamp(after));
  if (before) params.set("enddatetime", stamp(before));
  const text = await (await get(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { fetchImpl })).text();
  let data;
  try { data = JSON.parse(text); } catch { return []; } // GDELT answers plain text when throttled
  return (data.articles ?? []).map((a) => {
    const s = a.seendate ?? "";
    const iso = /^\d{8}T\d{6}Z$/u.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : null;
    return { origin: "gdelt", title: a.title ?? "", source: a.domain ?? "", link: a.url, publishedAt: iso };
  });
}

/** Fetches a page and reduces it to visible text. Returns "" on any failure (evidence is best-effort). */
export async function fetchPageText(url, { maxChars = 3000, fetchImpl } = {}) {
  try {
    if (/news\.google\.com/u.test(url)) return "";
    const response = await get(url, { fetchImpl, accept: "text/html" });
    const type = response.headers.get("content-type") ?? "";
    if (!/html|text/u.test(type)) return "";
    const html = (await response.text()).slice(0, 600_000);
    const body = html.replace(/<(script|style|noscript|nav|footer|header|aside)[\s\S]*?<\/\1>/giu, " ");
    const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/giu)].map((m) => stripTags(m[1])).filter((t) => t.length > 60);
    return paras.join(" ").slice(0, maxChars);
  } catch { return ""; }
}

const STOP = new Set("will the a an of in on at by for to be is are was were or and than this that before after during between does do did has have as with from its it their his her which who whom whose when where what how much many more less over under above below".split(" "));

/** Heuristic search queries from a question title: content words, plus the quoted head of the title. */
export function queriesFromTitle(title, { max = 2 } = {}) {
  const clean = title.replace(/\s*--.*$/u, "").replace(/[?"]/gu, " ").replace(/\s+/gu, " ").trim();
  const words = clean.split(" ").filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const queries = [words.slice(0, 8).join(" ")];
  if (max > 1) queries.push(`"${clean.split(" ").slice(0, 7).join(" ")}"`);
  return [...new Set(queries.filter(Boolean))].slice(0, max);
}

/**
 * Gathers evidence for a question. Returns {items, text, queries, errors}. `text` is a compact block (newest first)
 * of dated headlines plus the leading text of the top full articles, capped at `maxChars` for the model prompts.
 */
export async function gatherEvidence({ title, queries = null, asOf = null, lookbackDays = 30, maxItems = 14, fullArticles = 2, maxChars = 6000, fetchImpl, useGdelt = true } = {}) {
  const qs = queries ?? queriesFromTitle(title);
  const before = asOf ? new Date(asOf) : null;
  const after = before ? new Date(before.getTime() - lookbackDays * 864e5) : new Date(Date.now() - lookbackDays * 864e5);
  const items = [];
  const errors = [];
  for (const q of qs) {
    try { items.push(...await searchGoogleNews(q, { after, before, fetchImpl })); } catch (e) { errors.push(`news "${q}": ${e.message}`); }
  }
  if (useGdelt) {
    try { items.push(...await searchGdelt(qs[0], { after, before, fetchImpl })); } catch (e) { errors.push(`gdelt: ${e.message}`); }
  }
  const seen = new Set();
  const unique = items.filter((i) => {
    const k = i.title.toLowerCase().slice(0, 60);
    if (!i.title || seen.has(k)) return false;
    seen.add(k);
    return !before || !i.publishedAt || Date.parse(i.publishedAt) <= before.getTime();
  }).sort((a, b) => (Date.parse(b.publishedAt ?? 0) || 0) - (Date.parse(a.publishedAt ?? 0) || 0)).slice(0, maxItems);
  let bodies = 0;
  const lines = [];
  for (const it of unique) {
    let line = `- [${it.publishedAt?.slice(0, 10) ?? "undated"}] ${it.title} (${it.source || it.origin})`;
    if (bodies < fullArticles && it.origin === "gdelt") {
      const body = await fetchPageText(it.link, { fetchImpl });
      if (body) { line += `\n  ${body.slice(0, 1200)}`; bodies += 1; it.fetched = true; }
    }
    lines.push(line);
  }
  return { items: unique, text: lines.join("\n").slice(0, maxChars), queries: qs, errors };
}
