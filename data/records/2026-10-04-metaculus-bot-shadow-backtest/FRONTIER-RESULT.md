# Frontier-member shadow backtest: per-model and ensemble skill against the market, and the market-anchor test

Questions: 40 (the same 40 resolved Polymarket binaries, same as-of dates and evidence as RESULT.md). Market baseline = CLOB price at as-of (clamped 0.02-0.98). Intervals: paired bootstrap over questions, 2000 resamples, 95%. Negative difference = forecaster better than the market.

## Arm: retrieval

| Forecaster | n | Brier | Log loss | Market Brier (same n) | Diff vs market [95% CI] |
| --- | ---: | ---: | ---: | ---: | --- |
| always 0.50 | 40 | 0.250 | 0.693 | | |
| qwen-groq | 40 | 0.347 | 1.175 | 0.130 | 0.217 [0.102, 0.328] |
| llama-nvidia | 30 | 0.259 | 0.790 | 0.150 | 0.108 [-0.013, 0.230] |
| gpt-codex | 40 | 0.259 | 0.774 | 0.130 | 0.129 [0.045, 0.222] |
| ENSEMBLE gpt+qwen | 40 | 0.313 | 0.904 | 0.130 | 0.183 [0.094, 0.273] |
| ENSEMBLE zero-cash (qwen+llama) | 30 | 0.287 | 0.873 | 0.150 | 0.136 [0.017, 0.255] |

### Bot plus market anchor (logit blend, weight on the bot fit on one half, scored on the other, both directions), arm retrieval

| Forecaster | n | Fold | w on bot (fold A / fold B) | Blend Brier | Market Brier | Blend minus market [95% CI] |
| --- | ---: | --- | --- | ---: | ---: | --- |
| qwen-groq | 40 | chrono | 0.00 / 0.00 | 0.130 | 0.130 | 0.000 [-0.000, 0.000] |
| qwen-groq | 40 | alternate | 0.00 / 0.00 | 0.130 | 0.130 | 0.000 [-0.000, 0.000] |
| llama-nvidia | 30 | chrono | 0.00 / 0.80 | 0.242 | 0.150 | 0.092 [0.029, 0.171] |
| llama-nvidia | 30 | alternate | 0.30 / 0.00 | 0.171 | 0.150 | 0.020 [-0.007, 0.055] |
| gpt-codex | 40 | chrono | 0.00 / 0.25 | 0.144 | 0.130 | 0.013 [0.005, 0.023] |
| gpt-codex | 40 | alternate | 0.00 / 0.00 | 0.130 | 0.130 | 0.000 [-0.000, 0.000] |
| ENSEMBLE gpt+qwen | 40 | chrono | 0.00 / 0.00 | 0.130 | 0.130 | 0.000 [-0.000, 0.000] |
| ENSEMBLE gpt+qwen | 40 | alternate | 0.00 / 0.00 | 0.130 | 0.130 | 0.000 [-0.000, 0.000] |
| ENSEMBLE zero-cash (qwen+llama) | 30 | chrono | 0.00 / 0.00 | 0.150 | 0.150 | 0.000 [-0.000, 0.000] |
| ENSEMBLE zero-cash (qwen+llama) | 30 | alternate | 0.00 / 0.00 | 0.150 | 0.150 | 0.000 [-0.000, 0.000] |

In-sample full-data weight (an optimistic ceiling, not an estimate): qwen-groq w=0.00; llama-nvidia w=0.00; gpt-codex w=0.00; ENSEMBLE gpt+qwen w=0.00; ENSEMBLE zero-cash (qwen+llama) w=0.00

## Arm: no-retrieval

| Forecaster | n | Brier | Log loss | Market Brier (same n) | Diff vs market [95% CI] |
| --- | ---: | ---: | ---: | ---: | --- |
| always 0.50 | 40 | 0.250 | 0.693 | | |
| qwen-groq | 40 | 0.222 | 0.662 | 0.130 | 0.092 [-0.019, 0.214] |
| gpt-codex | 40 | 0.167 | 0.508 | 0.130 | 0.036 [-0.051, 0.127] |
| ENSEMBLE gpt+qwen | 40 | 0.178 | 0.528 | 0.130 | 0.048 [-0.047, 0.144] |

### Bot plus market anchor (logit blend, weight on the bot fit on one half, scored on the other, both directions), arm no-retrieval

| Forecaster | n | Fold | w on bot (fold A / fold B) | Blend Brier | Market Brier | Blend minus market [95% CI] |
| --- | ---: | --- | --- | ---: | ---: | --- |
| qwen-groq | 40 | chrono | 0.25 / 0.30 | 0.125 | 0.130 | -0.005 [-0.028, 0.015] |
| qwen-groq | 40 | alternate | 0.40 / 0.00 | 0.138 | 0.130 | 0.008 [-0.025, 0.034] |
| gpt-codex | 40 | chrono | 0.25 / 0.25 | 0.128 | 0.130 | -0.002 [-0.019, 0.013] |
| gpt-codex | 40 | alternate | 0.30 / 0.00 | 0.133 | 0.130 | 0.002 [-0.011, 0.013] |
| ENSEMBLE gpt+qwen | 40 | chrono | 0.30 / 0.50 | 0.127 | 0.130 | -0.003 [-0.036, 0.025] |
| ENSEMBLE gpt+qwen | 40 | alternate | 0.45 / 0.00 | 0.133 | 0.130 | 0.003 [-0.028, 0.026] |

In-sample full-data weight (an optimistic ceiling, not an estimate): qwen-groq w=0.25; gpt-codex w=0.25; ENSEMBLE gpt+qwen w=0.40

## Contamination checks

Leak probe, no-retrieval arm. Directional accuracy (p>0.5 vs outcome) and mean Brier on the earlier-resolving half versus the later half. Remembered outcomes would make the EARLIER half better; as-of dates run 2026-06-14 to 2026-09-13; see the cutoff table below for which models that is safely after.

| Forecaster | n | acc early | acc late | Brier early | Brier late |
| --- | ---: | ---: | ---: | ---: | ---: |
| qwen-groq | 40 | 0.800 | 0.600 | 0.174 | 0.270 |
| gpt-codex | 40 | 0.800 | 0.750 | 0.125 | 0.208 |
| ENSEMBLE gpt+qwen | 40 | 0.800 | 0.650 | 0.139 | 0.217 |

Retrieval lift (Brier no-retrieval minus retrieval, same questions; positive = headlines helped):
- qwen-groq: -0.125 over n=40
- gpt-codex: -0.093 over n=40
- repeat-call noise gpt-codex (same prompt text, two calls, n=10): RMS probability difference 0.250; Brier call 1 0.443 vs call 2 0.413

Provider-stated cutoffs (web search 2026-10-04; none verified by us):

| Member | Model as routed | Stated cutoff | Source | Safe margin before first as-of 2026-06-14 |
| --- | --- | --- | --- | --- |
| gemini-antigravity | gemini-3.1-pro-high (agy) | Jan 2025 | Gemini 3 Pro model card; 3.1 listings | yes, 17 months |
| gpt-codex | Codex 'default' (model name opaque to the dispatch; self-report: GPT-5-based, cutoff unknown, latest event Jul 2024) | GPT-5-Codex Sep 30 2024; GPT-5.5 Dec 2025 (Codex issue #24930 reports 'June 2024' self-claims) | OpenAI model docs | yes under either, 6+ months |
| qwen-groq | qwen/qwen3.8-27b | NOT published; model released 2026-08-14; self-report 'cutoff 2026, World Cup began June 2026' | Qwen HF discussion, kingy.ai | NO: cannot rule out that training data includes events before the as-of dates, or after early ones |
| llama-nvidia | meta/llama-3.2-11b-vision-instruct | Dec 2023 | Meta model card | yes |

Consequence: Qwen no-retrieval answers are not clean point-in-time forecasts. Frontier Gemini and GPT answers are, to the extent the stated cutoffs are true. Qwen's retrieval-arm score is unaffected by this except through the same possible memory.

## Calls and latency (this run's answers carry batchMs; earlier Qwen/Llama rows carry token counts only)

| Arm | Member | batch calls | median ms | total ms |
| --- | --- | ---: | ---: | ---: |
| retrieval | gpt-codex | 4 | 25764 | 97324 |
| retrieval-repeat | gpt-codex | 1 | 26423 | 26423 |
| no-retrieval | gpt-codex | 2 | 30216 | 59481 |
| retrieval | qwen-groq | 1 | 1297 | 1297 |
| no-retrieval | qwen-groq | 1 | 32818 | 32818 |
