# privilege-model-fallback-LAB

**Tier: Demo.** An LLM key with an ordered chain of models answers from the second model when the first is down, overloaded or out of budget, and the fallback is charged on its own budget. If no model can answer, the result is a named refusal that says which budgets ran out and which providers failed.

**Status: step 1 of 3 (engine and server API).** No web page, Docker image, CI workflow, shelf entry or content pack yet.

## What is simulated
Everything. Mock model providers (healthy, down, overloaded, timeout, slow), an LLM key with a token ledger per model and a lab clock; no network, nothing leaves the machine (a netguard enforces it). Only one thing is taken from the 2026-11-21 release notes: a key can name a second model, even on another provider, that answers when the first is down, overloaded or out of budget, and the fallback carries its own budget. **Every other behaviour is this lab's own model and UNVERIFIED** against the product (see `docs/spec.md`). Nothing here is verified against the real product.

## Run
```sh
npm install
npm start          # http://127.0.0.1:7836/api/info  (loopback only)
npm test           # node --test test/*.test.js (a glob)
npm run doctor     # one check per scenario, kit pin, netguard, an HTTP run of every scenario
npm run reset      # resets a running lab (default chain, empty ledgers, fresh clock)
```
Node 26. Heavy work on the Air: `air-test . -- npm test` (git add new files first).

## Port
**7836 is PROVISIONAL and NOT CLAIMED yet** (it was the next free port on 2026-11-23; claim it with `npm run ports -- --next` in demo-shelf-LAB before shipping). Set `PORT` (7800-7999) to move it.

## Mock and Real
Mock only. `GET /api/info` reports `source: mock`, `realAvailable: false` with a plain reason; `POST /api/mode {"source":"real"}` answers 409. Real (owner-run, read-only, needs a tenant running the 2026-11-21 release) comes after Mock.

## Scenarios
`GET /api/scenarios`; run one with `POST /api/scenario/:id`: primary-healthy, primary-down, primary-overloaded, primary-out-of-budget, fallback-different-provider, both-budgets-exhausted, both-providers-down, one-model-chain, slow-primary-timeout. Each carries a hand-written expected result.

## Observability
Step 1 keeps no log store. The run result carries every attempt (provider, model, status, latency, tokens, reason), the totals and each model's ledger. The "what this run left behind" panel is a later step; this lab never claims a product logged anything.

## Vendored
`server/src/model-gateway-sim/` is copied byte for byte from `shared/model-gateway-sim` and pinned by `server/test/model-gateway-sim.sha256` (a test and a doctor check). `server/src/health.js` is the shared `shared/health` copy. Never hand-edit; change the kit first, then re-vendor and re-pin.
