// Appends one executor's batch answers (the model's JSON text, as delivered) to answers.jsonl.
// usage: node exec-add.mjs <dir> <arm> <memberId> <family> <promptTokens> <completionTokens> < model-json-on-stdin
import { appendFileSync, readFileSync } from "node:fs";
const [dir, arm, member, family, pt, ct] = process.argv.slice(2);
const j = JSON.parse(readFileSync(0, "utf8"));
let n = 0;
const seen = new Set();
for (const a of j.answers) {
  if (seen.has(String(a.id))) continue;
  seen.add(String(a.id));
  const p = Number(a.probability);
  if (!Number.isFinite(p)) continue;
  appendFileSync(`${dir}/answers.jsonl`, `${JSON.stringify({ arm, member, family, id: String(a.id), probability: Math.min(0.99, Math.max(0.01, p)), batchPromptTokens: Number(pt), batchCompletionTokens: Number(ct), batchItems: j.answers.length })}\n`);
  n += 1;
}
console.log(`${n} answers`);
