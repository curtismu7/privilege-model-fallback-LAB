# privilege-model-fallback-LAB

**Tier: Demo.** An LLM key with an ordered chain of models answers from the second model when the first is down, overloaded or out of budget, and the fallback is charged on its own budget. If no model can answer, the result is a named refusal that says which budgets ran out and which providers failed.

**Status: step 2 of 3 (web UI, presenter mode, talk track, content pack, Docker).** Step 3 (shelf registry entry, proxy route, submodule pin, release) is the owner's integration step and is not done here.

## What is simulated
Everything. Mock model providers (healthy, down, overloaded, timeout, slow), an LLM key with a token ledger per model and a lab clock; no network, nothing leaves the machine (a netguard enforces it). Only one thing is taken from the 2026-11-21 release notes: a key can name a second model, even on another provider, that answers when the first is down, overloaded or out of budget, and the fallback carries its own budget. **Every other behaviour is this lab's own model and UNVERIFIED** against the product (see `docs/spec.md` and the Limits page). Nothing here is verified against the real product. The Mock or Real modal that opens the page says so (once per browser session).

## Run
```sh
npm ci
npm run build      # builds web/dist, which the server serves
npm start          # http://127.0.0.1:7836/  (loopback only; the API is under /api)
npm test           # server (node --test test/*.test.js), web (vitest), scripts (node --test scripts/*.test.mjs)
npm run doctor     # one check per scenario, kit pin, stories and diagram, netguard, an HTTP run of every scenario
npm run reset      # resets ONE workspace of a running lab: its default chain, empty budgets, clock at zero, last run and run log cleared
                   # the "default" workspace unless PMF_WORKSPACE=<id> or a second argument names one: node scripts/reset.mjs [base-url] [workspace]
./scripts/run.sh   # install if needed, build if needed, doctor, start
```
Docker (OrbStack): `HOST_PORT=7836 docker compose up --build -d`, published on `127.0.0.1` only, non-root, `restart: unless-stopped`, healthcheck on `/api/health`. Branding in Docker: the root file system is read-only, so `customer.config.json` is mounted, not written: copy `customer.config.example.json` to `customer.config.json`, uncomment the `volumes` block in `docker-compose.yml` and set `CUSTOMER_CONFIG=/config/customer.config.json`. Without it the lab runs with its defaults.
Node 26. Heavy work on the Air: `air-test . -- npm test` (git add new files first). The tests need no web build.

## Pages
- **Fallback**: the key form (a chain of 1 to 5 models: provider, model, budget, and the state the next run gives each provider), a prompt, the nine scenarios, then the result: the verdict first (which model served, or the named refusal), every attempt, a budget meter per model, the trace of every hop (shared `GatewayTrace`) and what the run left behind (below).
- **Diagram**: `model-fallback`, loaded by name from diagram-studio data: movable boxes, Simulate, Prev/Next, speed, and Reset (also restores the box positions).
- **Stories and talk track**: nine stories as data with `{{cast}}` tokens and four vertical packs (airlines, retail, health, finance; the default is AirGuard Airlines, a fictional airline), filled for the vertical picked in the header; each opens its scenario. The talk track is `docs/talk-track.md`, one source for the page, the header dialog and presenter mode (`P`).
- **Limits (UNVERIFIED)**: exactly what the release notes say and what is the lab's own model.

## Port
**7836 is PROVISIONAL and NOT CLAIMED yet** (it was the next free port on 2026-11-23; claim it with `npm run ports -- --next` in demo-shelf-LAB before shipping). Set `PORT` (7800-7999) to move it.

## Mock and Real
Mock only. The header toggle shows Mock pressed and Real disabled with the server's reason. `GET /api/info` reports `source: mock`, `realAvailable: false` with a plain reason; `POST /api/mode {"source":"real"}` answers 409. Real (owner-run, read-only, needs a tenant running the 2026-11-21 release) comes after Mock.

## Workspaces and branding
Each browser tab sends `X-Workspace` (default `default`); the key, its budgets, the lab clock, the last run and the run log are per workspace, and Reset clears one. The server answers `X-Workspace-Fresh: 1` when a request had to create the workspace (a restart, or the 21st workspace evicting the oldest); a tab that already used its id then shows "The server forgot this workspace; the lab was reset to its defaults" and reloads the key. `customer.config.json` (git-ignored; see `customer.config.example.json`) sets the lab's name, tagline, vertical and the five cast words; a bad field falls back to its default with a warning.

## Scenarios
`GET /api/scenarios`; run one with `POST /api/scenario/:id`: primary-healthy, primary-down, primary-overloaded, primary-out-of-budget, fallback-different-provider, both-budgets-exhausted, both-providers-down, one-model-chain, slow-primary-timeout. Each carries a hand-written expected result, and the UI shows whether the run equals it.

## Observability (rule 27)
Every run, live or a scenario, leaves two things. **On the lab's standard output (`docker logs`)** one line per decision: `<iso time> privilege-model-fallback-lab decision step=<step> actor=<model> result=passed|stopped|unclear run=<id>`, never a prompt or a key. **In the page**, under the result, the shared "what this run left behind" panel lists the same decisions in time order across the six layers; every row is tagged **simulated** (the lab's mock computed it) and a layer with nothing says **not logged** (Person, Authorize and Agent gateway have nothing here). Agent is the calling app, Privilege is the lab's model of the LLM gateway's budget decisions, Resource server is the model provider. The lab reads no log, so it claims nothing about what any product logged; whether and where the real gateway logs a fallback is UNVERIFIED. Where such logs could stream (a log collector to a SIEM) is named in the panel's "where these logs live" block. Time is when the lab computed it: the run's start plus the lab clock's offsets.

## Vendored
`server/src/model-gateway-sim/` is copied byte for byte from `shared/model-gateway-sim` and pinned by `server/test/model-gateway-sim.sha256`. `server/src/health.js`, `gatewayTrace.js`, `runObservability.js`, `web/src/{top-menu,floating-dialog,diagram-kit,gateway-trace,run-observability,talk-track}/`, `web/src/components/JsonPane.*` and `web/src/standalone-ui.css` are copies of the family's shared components, each pinned by a test. Never hand-edit; change the shared component first, then re-vendor and re-pin. The diagram data `server/diagrams/model-fallback.json` is a byte copy of the diagram-studio data, pinned by `server/diagrams/diagrams.sha256`, which names the source commit.
