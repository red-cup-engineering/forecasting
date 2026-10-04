/**
 * Metaculus API client for the FutureEval / MiniBench bot tournaments.
 *
 * API shape taken from Metaculus's open-source forecasting-tools
 * (forecasting_tools/helpers/metaculus_client.py, data_models/questions.py,
 * data_models/numeric_report.py), read 2026-10-04:
 *   base      https://www.metaculus.com/api
 *   auth      Authorization: Token <bot token>
 *   list      GET  /posts/?tournaments=<id|slug>&statuses=open&limit<=100&offset&order_by=-published&with_cp=true
 *   one post  GET  /posts/<postId>/
 *   forecast  POST /questions/forecast/   body = [{question, source:"api", ...payload}]
 *               binary           probability_yes: 0.001..0.999
 *               numeric / date   continuous_cdf: cdf_size (default 201) monotone values
 *               multiple_choice  probability_yes_per_category: {option: p}, sums to 1
 *   comment   POST /comments/create/  {on_post, text, is_private, included_forecast}
 *
 * Observed 2026-10-04: an unauthenticated GET /posts/ answers 403 "The API is only available to authenticated users",
 * so EVERY call here, reads included, refuses without METACULUS_TOKEN. Nothing in this module reads a file or .env;
 * the token comes from the caller or the process environment only.
 *
 * Pure of house state: `fetchImpl` and `sleep` are injectable so the module is testable without a network.
 */

export const DEFAULT_BASE_URL = "https://www.metaculus.com/api";
export const FALL_2026_FUTUREEVAL = 33121; // slug fall-futureeval-2026 (forecasting-tools FE_FALL_2026_ID)
export const MINIBENCH = "minibench"; // forecasting-tools CURRENT_MINIBENCH_ID
export const TOKEN_ENV_VAR = "METACULUS_TOKEN";
export const USER_AGENT = "561-group-forecasting-bot/0.1 (Metaculus bot-tournament entrant; https://561.group)";
export const BINARY_PROBABILITY_RANGE = Object.freeze([0.001, 0.999]);

export class MetaculusTokenAbsentError extends Error {
  constructor(operation) {
    super(`metaculus: ${operation} refused: ${TOKEN_ENV_VAR} is not set (the founder creates the bot account and token; nothing here can)`);
    this.name = "MetaculusTokenAbsentError";
    this.code = "METACULUS_TOKEN_ABSENT";
  }
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const ms = typeof value === "number" ? (value > 1e11 ? value : value * 1000) : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const numOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Date-question bounds arrive as ISO strings or unix seconds; the CDF axis is unix seconds. */
export function boundToAxisNumber(value, questionType) {
  if (questionType !== "date") return numOrNull(value);
  if (typeof value === "number") return value > 1e11 ? value / 1000 : value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : numOrNull(value);
}

/**
 * Normalizes one API question object (post.question, or one entry of post.group_of_questions.questions) into the
 * bot's question shape. Returns null for types the bot does not forecast (conditional, notebook, unknown).
 */
export function normalizeApiQuestion(post, question, { groupLabel = null } = {}) {
  const type = question?.type;
  if (!["binary", "numeric", "discrete", "date", "multiple_choice"].includes(type)) return null;
  const scaling = question.scaling ?? {};
  const tournaments = (post.projects?.tournament ?? []).map((t) => String(t.slug ?? t.id));
  const base = {
    postId: post.id,
    questionId: question.id,
    type,
    title: groupLabel ? `${post.title ?? question.title} -- ${groupLabel}` : (question.title ?? post.title),
    description: question.description ?? "",
    resolutionCriteria: question.resolution_criteria ?? "",
    finePrint: question.fine_print ?? "",
    unit: question.unit ?? "",
    status: question.status ?? post.status ?? null,
    openTime: isoOrNull(question.open_time ?? post.open_time),
    closeTime: isoOrNull(question.scheduled_close_time ?? post.scheduled_close_time),
    resolveTime: isoOrNull(question.scheduled_resolve_time ?? post.scheduled_resolve_time),
    tournaments,
    pageUrl: `https://www.metaculus.com/questions/${post.id}/`,
    myLatestForecast: question.my_forecasts?.latest ?? null,
  };
  if (type === "multiple_choice") return { ...base, options: [...(question.options ?? [])] };
  if (type === "binary") return base;
  const rangeMin = boundToAxisNumber(scaling.range_min, type);
  const rangeMax = boundToAxisNumber(scaling.range_max, type);
  if (rangeMin === null || rangeMax === null) return null;
  return {
    ...base,
    scaling: {
      rangeMin,
      rangeMax,
      zeroPoint: numOrNull(scaling.zero_point),
      nominalMin: numOrNull(scaling.nominal_min),
      nominalMax: numOrNull(scaling.nominal_max),
      cdfSize: (numOrNull(scaling.inbound_outcome_count) ?? 200) + 1,
    },
    openLower: question.open_lower_bound !== false,
    openUpper: question.open_upper_bound !== false,
  };
}

/** One post (single, group of questions) to zero or more forecastable questions. Conditionals and notebooks yield none. */
export function flattenPost(post) {
  if (!post || post.notebook) return [];
  if (post.group_of_questions?.questions) {
    return post.group_of_questions.questions.map((q) => normalizeApiQuestion(post, q, { groupLabel: q.label ?? null })).filter(Boolean);
  }
  if (post.question) {
    const q = normalizeApiQuestion(post, post.question);
    return q ? [q] : [];
  }
  return [];
}

export function createMetaculusClient({
  token = process.env[TOKEN_ENV_VAR],
  baseUrl = process.env.METACULUS_API_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  userAgent = USER_AGENT,
  minIntervalMs = 1000,
  retries = 3,
  sleep = sleepMs,
  now = () => Date.now(),
} = {}) {
  let last = 0;
  const requireToken = (operation) => {
    if (!token || String(token).trim() === "") throw new MetaculusTokenAbsentError(operation);
    return String(token).trim();
  };

  async function request(operation, method, path, { params, body } = {}) {
    const tok = requireToken(operation);
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === null) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
    }
    let attempt = 0;
    for (;;) {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Token ${tok}`, "Accept-Language": "en", "User-Agent": userAgent, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      const detail = (await response.text().catch(() => "")).slice(0, 600);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= retries) {
        const error = new Error(`metaculus: ${operation} ${method} ${url.pathname} -> HTTP ${response.status}: ${detail}`);
        error.status = response.status;
        throw error;
      }
      attempt += 1;
      await sleep(Math.min(30_000, 2000 * 2 ** attempt));
    }
  }

  return {
    baseUrl,
    hasToken: Boolean(token && String(token).trim()),

    /** All open posts of a tournament (id or slug) as flattened forecastable questions. Pages through `next`. */
    async listOpenQuestions(tournament, { statuses = ["open"], maxPages = 10 } = {}) {
      const out = [];
      for (let page = 0; page < maxPages; page += 1) {
        const data = await request("listOpenQuestions", "GET", "/posts/", {
          params: { tournaments: tournament, statuses, limit: 100, offset: page * 100, order_by: "-published", with_cp: "true", include_conditional_cps: "true" },
        });
        for (const post of data?.results ?? []) out.push(...flattenPost(post));
        if (!data?.next || (data.results ?? []).length === 0) break;
      }
      return out;
    },

    async getPost(postId) {
      return request("getPost", "GET", `/posts/${postId}/`);
    },

    async getQuestionByPostId(postId) {
      return flattenPost(await this.getPost(postId));
    },

    /** The authenticated forecast POST. `payload` is one of the three shapes above; validated before sending. */
    async postForecast(question, payload) {
      requireToken("postForecast");
      assertPayloadFitsQuestion(question, payload);
      return request("postForecast", "POST", "/questions/forecast/", { body: [{ question: question.questionId, source: "api", ...payload }] });
    },

    /** Private reasoning comment (public after the question closes), attached to the forecast. */
    async postComment(postId, text, { isPrivate = true, includedForecast = true } = {}) {
      return request("postComment", "POST", "/comments/create/", { body: { on_post: postId, text, is_private: isPrivate, included_forecast: includedForecast } });
    },
  };
}

/** Throws unless the payload is exactly what the API takes for this question type. Used by the real POST and the dry run. */
export function assertPayloadFitsQuestion(question, payload) {
  const fail = (msg) => { throw new TypeError(`metaculus: payload for question ${question.questionId} (${question.type}): ${msg}`); };
  if (question.type === "binary") {
    const p = payload.probability_yes;
    if (typeof p !== "number" || !(p >= BINARY_PROBABILITY_RANGE[0] && p <= BINARY_PROBABILITY_RANGE[1])) fail(`probability_yes must be in [0.001, 0.999], got ${p}`);
  } else if (question.type === "multiple_choice") {
    const m = payload.probability_yes_per_category;
    if (!m || typeof m !== "object") fail("probability_yes_per_category required");
    const keys = Object.keys(m);
    if (keys.length !== question.options.length || !question.options.every((o) => keys.includes(o))) fail("categories must be exactly the question options");
    const sum = keys.reduce((s, k) => s + m[k], 0);
    if (Math.abs(sum - 1) > 1e-6 || keys.some((k) => !(m[k] > 0))) fail(`probabilities must be positive and sum to 1, sum=${sum}`);
  } else {
    const c = payload.continuous_cdf;
    if (!Array.isArray(c) || c.length !== question.scaling.cdfSize) fail(`continuous_cdf must have ${question.scaling.cdfSize} values`);
    for (let i = 1; i < c.length; i += 1) if (!(c[i] - c[i - 1] >= 5e-5 - 1e-12)) fail(`cdf must rise by at least 5e-5 per step (index ${i})`);
    if (c.some((x) => x < 0 || x > 1)) fail("cdf values must lie in [0,1]");
    if (!question.openLower && c[0] !== 0) fail("closed lower bound requires cdf[0] = 0");
    if (!question.openUpper && Math.abs(c[c.length - 1] - 1) > 1e-9) fail("closed upper bound requires cdf[-1] = 1");
  }
  return true;
}
