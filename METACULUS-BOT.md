# Metaculus FutureEval / MiniBench bot

Entrant for the Metaculus Fall 2026 FutureEval bot tournament (tournament id 33121, slug `fall-futureeval-2026`) and MiniBench (`minibench`). Built on this package's `forecasting.mjs` (scoring, calibration buckets), `evidence-fusion.mjs` (SignChain conflict flag over member estimates) and the house inference market. Nothing here creates an account, holds a key, or posts unless started with `--live`.

## Files

| File | Role |
| --- | --- |
| `src/metaculus-client.mjs` | API client (shape from Metaculus `forecasting-tools`). Every call, reads included, refuses without `METACULUS_TOKEN` (an unauthenticated `GET /posts/` answers 403 "only available to authenticated users", observed 2026-10-04). |
| `src/metaculus-cdf.mjs` | Numeric / date / discrete: percentiles to a 201-point `continuous_cdf`, with Metaculus's standardization (closed bounds get no outside mass, open bounds minimum mass, per-step rise >= 5e-5, per-step cap), log scale via `zero_point`, Vincentized ensemble. |
| `src/probability-calibration.mjs` | Pooling (trimmed logit-mean / median), extremizing, Platt fit, floor/cap, option-vector calibration, bootstrap. Applied last. |
| `src/web-research.mjs` | Keyless evidence: Google News RSS (date-filterable), GDELT DOC 2.0 (5 s spacing), page fetch; honest User-Agent. |
| `src/house-inference.mjs` | Ensemble through MetroPlat `inference_dispatch_inference` over MCP as the node's machine client. One member = one provider (all others in `excludeProviders`); wrong-provider and Claude/Anthropic deliveries are discarded; outcome judged back to the market. |
| `src/forecast-bot.mjs` | Agent core: evidence, prompts per question type, parse, pool, calibrate, payload, reasoning comment. Needs >= 3 usable members from >= 3 families or refuses. |
| `scripts/metaculus-tick.mjs` | The poller (below). |
| `scripts/metaculus-backtest.mjs` | Point-in-time shadow backtest (below). |
| `content/config/metaculus-bot.json` | Tournaments, members, calibration, tick limits. Data, refit it from backtests. |
| `content/deploy/metaculus-bot.{service,timer}` | systemd user units (not installed). |
| `test/metaculus-bot.test.mjs` | Unit tests with stubbed network and inference. |
| `data/records/2026-10-04-metaculus-bot-shadow-backtest/` | Backtest inputs, answers, `RESULT.md`. |

## Tick behaviour

`node scripts/metaculus-tick.mjs` (dry-run by default): lists open tournament questions, soonest close first; forecasts each new one once (at most 6 per tick, 7 minute budget); re-checks after 30 minutes and re-forecasts only when the evidence fingerprint changed and the probability moved >= 0.03 (binary) ; always one final pass in the last 25 minutes before close, because only the last forecast before close is scored. Skips questions closing in under 8 minutes. State in `~/.local/state/561-group/settlements/forecasting-service/metaculus/`: `questions/<id>.json` (forecast history), `ledger.jsonl` (every event), `usage.jsonl` (per member call: provider, model, tokens, ms), `would-submit/` (dry-run payload plus comment). Exit 3 = token absent, 4 = house inference credentials absent.

## Founder steps

1. Create (or sign in to) the human Metaculus account that will own the bot and receive any prize (decide the legal payee; expect a W-9 and the post-season verification and survey).
2. From that account create a bot account (account settings, bots section; the API route `POST /api/users/me/bots/create/` with the owner's token does the same) and copy the **bot's** API token. One prize-eligible bot per owner; a second bot must be labelled v2.
3. Confirm the bot is entered in Fall FutureEval (the participate page; not verified, metaculus.com returned 403 to the scout).
4. `install -m 600 /dev/null ~/.config/561-group/metaculus.env && echo 'METACULUS_TOKEN=<token>' > ~/.config/561-group/metaculus.env`
5. Dry-run once by hand: `cd <this package> && set -a && . ~/.config/561-group/metaculus.env && . ~/.config/561-group/bare-cedar-fog.561.group-mcp-client.env && set +a && node scripts/metaculus-tick.mjs --state-dir /tmp/mc-try`. Read `/tmp/mc-try/would-submit/*.json`.
6. Node job (cadence every 10 minutes): copy `content/deploy/metaculus-bot.{service,timer}` to `~/.config/systemd/user/`, then `systemctl --user daemon-reload && systemctl --user enable --now metaculus-bot.timer`. To go live add `--live` to `ExecStart` in the service (that edit is the arming act).

## Rules the bot respects

No human in the loop (nothing here lets a person preview or tune on open questions); private reasoning comment with every forecast; external forecasts may be inputs but none is used yet; the bot never creates questions.

## Limits to know before arming

See `data/records/2026-10-04-metaculus-bot-shadow-backtest/RESULT.md`. In short: with the providers that are zero-cash today, the ensemble does not beat a liquid market price and is worse than a constant 0.5 on the retrieval arm. Metaculus scores against other bots (frontier models, paid search), a different and easier-to-lose-badly baseline in some ways, harder in others; do not read the backtest as an estimate of tournament rank. Provider availability is also uneven: in the 2026-10-04 trials Groq (Qwen) and NVIDIA (Llama 3.2 11B) answered every call, OpenRouter (Cohere) answered small prompts but aborted a 10-item prompt after 76 s, Gemini (Gemma) timed out once and returned HTTP 500 once, Antigravity answered "concurrency bound occupied". The >= 3 families rule will therefore skip questions on bad days.
