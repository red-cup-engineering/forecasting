/**
 * The bot's only way to a model: the house inference market (MetroPlat `inference_dispatch_inference`) over the node's
 * MCP surface as the node's machine client (MCP_ORIGIN, MCP_CLIENT_ID, MCP_CLIENT_SECRET). No provider key is ever
 * held or read here.
 *
 * Ensemble diversity is enforced, not hoped for: a member names one provider, and every other known provider is passed in
 * `excludeProviders`, so one member = one model family. After delivery the provider is checked against the member; a
 * delivery from anyone else, or from any Claude/Anthropic carrier, is refused. Subscription carriers (antigravity) need
 * zeroCashOnly=false; the Claude carrier is not admitted on the node (founder 2026-10-03) and is never a member.
 *
 * The market's quality prior learns from our judgement of each delivery, so a parsed delivery is recorded `accepted`
 * and an unparseable one `refused` (inference_record_inference_outcome), best-effort.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVIDER = Object.freeze({
  groq: "urn:ame:groq-inference-team",
  gemini: "urn:ame:gemini-inference-team",
  openrouter: "urn:ame:openrouter-inference-team",
  nvidia: "urn:ame:nvidia-inference-team",
  cloudflare: "urn:ame:cloudflare-workers-ai-inference-team",
  npu: "urn:ame:bare-cedar-fog-npu-inference-team",
  codex: "urn:ame:bare-cedar-fog-codex-inference-team",
  antigravity: "urn:ame:bare-cedar-fog-antigravity-inference-team",
});
const FORBIDDEN_PROVIDER = /claude|anthropic/iu;

/** Observed 2026-10-04 via inference_inspect_inference_resources; override in content/config/metaculus-bot.json. */
export const DEFAULT_MEMBERS = Object.freeze([
  { id: "qwen-groq", family: "qwen", provider: PROVIDER.groq, zeroCashOnly: true },
  { id: "gemma-gemini", family: "gemma", provider: PROVIDER.gemini, zeroCashOnly: true },
  { id: "cohere-openrouter", family: "cohere", provider: PROVIDER.openrouter, zeroCashOnly: true },
  { id: "llama-nvidia", family: "llama", provider: PROVIDER.nvidia, zeroCashOnly: true },
  { id: "gemini-antigravity", family: "gemini", provider: PROVIDER.antigravity, zeroCashOnly: false, optional: true },
  { id: "gpt-codex", family: "gpt", provider: PROVIDER.codex, zeroCashOnly: false, optional: true },
]);

/** Locates the house MCP call-tool module the same way the inference engine's own market does (it imports it by package name). */
async function defaultCallTool() {
  const marketUrl = import.meta.resolve("@red-cup-engineering/computer-inference-engine/dispatch/remote-inference-market");
  let dir = dirname(fileURLToPath(marketUrl));
  for (let i = 0; i < 14; i += 1) {
    if (dir.endsWith("computer-engineering-services-section")) {
      const file = join(dir, "services/computer-networking-engineering-services-section/services/mcp-engineering-services-section/scripts/call-tool.mjs");
      return (await import(file)).callMcpTool;
    }
    dir = dirname(dir);
  }
  throw new Error("house-inference: cannot locate the MCP call-tool module");
}

/** Tolerant JSON extraction: whole text, a fenced block, or the outermost braces. */
export function parseJsonLoose(text) {
  const t = String(text ?? "").trim();
  const candidates = [t, (t.match(/```(?:json)?\s*([\s\S]*?)```/u) ?? [])[1], t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try { const v = JSON.parse(c); if (v && typeof v === "object") return v; } catch { /* next */ }
  }
  return null;
}

export function createHouseInference({
  env = process.env,
  members = DEFAULT_MEMBERS,
  callTool = null,
  timeoutMs = 90_000,
  taskClass = "bounded-derivation",
  usageSink = () => {},
} = {}) {
  let resolved = callTool;
  const call = async (args) => {
    resolved ??= await defaultCallTool();
    return resolved({ origin: env.MCP_ORIGIN, clientId: env.MCP_CLIENT_ID, clientSecret: env.MCP_CLIENT_SECRET, timeoutMs, ...args });
  };
  const everyone = Object.values(PROVIDER);

  return {
    members,
    ready: Boolean(callTool) || Boolean(env.MCP_ORIGIN && env.MCP_CLIENT_ID && env.MCP_CLIENT_SECRET),

    /** One member, one chat turn. Resolves {member, text, meta}; rejects on dispatch failure or a wrong-provider delivery. */
    async ask(member, { system, user, temperature = 0.4, objective = "Forecast a probability for a tournament question; return strict JSON." }) {
      const started = Date.now();
      const delivery = await call({
        tool: "inference_dispatch_inference",
        input: {
          objective, taskClass, routingProfile: "bounded", zeroCashOnly: member.zeroCashOnly !== false,
          excludeProviders: everyone.filter((p) => p !== member.provider),
          chatCompletion: { messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature, response_format: { type: "json_object" } },
        },
      });
      const provider = String(delivery?.provider ?? "");
      if (FORBIDDEN_PROVIDER.test(provider) || provider !== member.provider) {
        throw new Error(`house-inference: member ${member.id} wanted ${member.provider} but the market delivered from ${provider || "nobody"}; discarded`);
      }
      const text = delivery?.candidate?.choices?.[0]?.message?.content;
      const usage = delivery?.candidate?.usage ?? {};
      const meta = {
        member: member.id, family: member.family, provider, model: delivery.model, workLot: delivery.workLot,
        promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null,
        ms: delivery.durationMs ?? Date.now() - started, receipt: delivery.receipt?.id ?? null,
      };
      usageSink(meta);
      if (typeof text !== "string" || !text.trim()) throw new Error(`house-inference: ${member.id} delivered no text`);
      return { member, text, meta, lot: delivery };
    },

    /** Best-effort judgement back to the market so its quality prior learns. */
    async judge(delivery, accepted, evidence) {
      try {
        await call({
          tool: "inference_record_inference_outcome",
          input: {
            workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass ?? taskClass,
            selectedOffer: delivery.selectedOffer, receipt: delivery.receipt?.id, receiver: delivery.receiver,
            outcome: accepted ? "accepted" : "refused", evidence,
          },
        });
      } catch { /* judgement is a courtesy to the prior, never a failure of the forecast */ }
    },
  };
}
