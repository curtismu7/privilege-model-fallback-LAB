# privilege-model-fallback-LAB spec

**Status:** step 1 (engine and server API) built; web, Docker, CI, shelf and content pack are later steps. **Owner:** Curtis Muir (decides). **Tier:** Demo (Tier 2: colleagues will present it). Source: the 2026-11-21 vendor release notes, the only source. Everything else is **UNVERIFIED (model)** and the lab says so. Parent spec: `docs/specs/2026-11-24-model-gateway-labs.md` in AI-DEMO-Standalone, "Lab 1".

## Goal
Show an LLM key answering from a second model when its first is down, overloaded or out of budget, within the fallback's own budget, with the serving model named and every attempt traced.

## What the release notes say (the only sourced claims)
An LLM key names a second model that answers when the first is down, overloaded or out of budget; the fallback can be a different provider; the fallback carries its own budget. Nothing else is claimed.

## Model (the lab's own, UNVERIFIED)
- A key has an ordered chain of 1 to 5 models `{provider, model, budgetTokens}`; each has its own ledger and its own mock provider on one lab clock (`server/src/model-gateway-sim/`, vendored from `shared/model-gateway-sim`, pinned).
- A call tries the chain in order; the first model that answers wins. A model is skipped, with no provider call, when its remaining budget cannot cover the call (cost = input words + 120 reply tokens). A model that fails (down 503, overloaded 429, timeout 504, all provider-origin) is skipped. No retry before fallback.
- Only the serving model is charged, on its own ledger. A ledger never overdraws; a zero budget is out of budget at once.
- If nothing answers, the result is a named refusal: `all_budgets_exhausted`, `all_providers_failed`, `chain_exhausted` (mixed) or `no_fallback_configured` (one-model chain). Its message names each model and why (which budgets ran out, which providers failed). It is returned as a normal result (HTTP 200, `ok: false`); the product's refusal status is UNVERIFIED so none is imitated.
- Provider state is per chain position (a model), not per provider: the lab's simplification.
- The Bedrock assumed-role target is a labelled stub provider (`bedrock-assumed-role-stub`) until lab 4's evaluator exists.

## API (`/api`, loopback only, Host check 421, same-origin writes 403)
`GET /health` (demo-health/1), `GET /info`, `GET|POST /mode` (`{source}`; Real is 409 with a reason), `GET|PUT /chain` (`{chain, timeoutMs?}`; PUT builds fresh ledgers), `POST /run` (`{prompt, providerStates?}`), `GET /scenarios`, `POST /scenario/:id` (fresh key and clock, never touches the live key), `POST /reset`.

## Acceptance (each is a test and, for scenarios, a `npm run doctor` check)
1. `primary-healthy`: primary serves, one attempt, no fallback in the trace.
2. `primary-down`, `primary-overloaded`, `primary-out-of-budget`: the fallback serves, the result names it, the trace lists both attempts with latency.
3. `fallback-different-provider`: a model on another provider serves.
4. `both-budgets-exhausted`: a named refusal that says which budgets ran out; no provider called; nothing charged.
5. The fallback's spend lands on its own ledger, never the primary's.
6. `slow-primary-timeout`: a slow primary reaching the key's timeout is a 504 after the timeout, then fallback.
7. `one-model-chain` and `both-providers-down`: named refusals (`no_fallback_configured`, `all_providers_failed`).
8. Zero-token budget: out of budget (the kit's zero-token spend succeeds, so `remaining()` decides).
9. Doctor passes, one check per scenario; netguard sees zero outbound attempts; the kit pin matches.

## Unhappy paths (each has a test)
Prompt empty, over 20000 characters or not a string (4xx); chain empty, over 5, duplicate, unknown provider id, bad model id, budget not a whole number 0 to 1,000,000, timeout outside 100 to 60000 ms; any unknown field (so no credential field can be sent); `__proto__` key; invalid JSON (400), body over 256 KB (413), wrong method (405), unknown route (404), unknown scenario (404); bad Host (421); cross-origin write (403); `real` mode (409); error messages never echo the caller's text.

## UNVERIFIED (model)
What "overloaded" means; retry before fallback; mid-stream failure; whether the guard re-runs on the fallback's answer; how the response names the serving model; refusal wording and status; token counting. Open question, not modelled and no claim made: whether a gateway's own rate-limit refusal can trigger fallback (owner decision 2026-11-24).

## Out of scope
Real provider calls, streaming, the web page, Real mode (owner-run, read-only, after Mock), Docker, `ci.yml`, shelf entry, content pack, stories, workspaces per visitor.
