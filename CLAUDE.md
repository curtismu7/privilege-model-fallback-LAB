# privilege-model-fallback-LAB

Demo-tier standalone lab, step 2 (engine, API and web UI). Port **7836 PROVISIONAL, not claimed**. Spec: `docs/spec.md`. Source of claims: the 2026-11-21 release notes only; everything else is UNVERIFIED (lab model) and the banner (`server/src/data.js`) says so. Never present anything here as a Ping statement.

- Run `npm start`; test `npm test` (glob); preflight `npm run doctor`; reset `npm run reset` (clears ONE workspace: `default`, or the id in `PMF_WORKSPACE` / the second argument; other workspaces are untouched). Node 26. Tests go to the Air: `air-test . -- npm test`.
- Core: `server/src/fallback.js` (the engine: chain, per-model ledger, named refusal), `scenarios.js` (scenarios as data with hand-written expectations), `validate.js` (bounds), `app.js` (one `ROUTES` table), `doctor.js` (one check per scenario), `netguard.js`, `safety.js` (bind, Host 421, same-origin).
- Rules that bite: Mock only, zero outbound (netguard + test). `server/src/model-gateway-sim/` and `health.js` are vendored byte for byte, never edited (pin test + doctor). No credential field anywhere: unknown fields are refused. Refusals are named results (HTTP 200), never blank. No claim about a gateway's own rate-limit refusals and fallback (owner, 2026-11-24). Hosts are `.example`/`.invalid` only. No AI attribution in commits or files.
- Web (`web/`, React + Vite, built to `web/dist`, served by the server; tests need no build): pages Fallback, Diagram, Stories and talk track, Limits. Everything vendored from `shared/` (top-menu, floating-dialog, talk-track, diagram-kit, gateway-trace, run-observability, JsonPane, standalone-ui.css) is pinned by a test and never hand-edited: change the shared component first. Diagram data `server/diagrams/model-fallback.json` is a byte copy from diagram-studio (pin names the source commit; re-export after diagram-studio PR #35 merges).
- State is per workspace (`X-Workspace`, default `default`): key, clock, last run, run log (`workspaces.js`). Stories are data (`server/src/data/stories`, `{{cast}}` tokens, three packs in `data/verticals`), the talk track is `docs/talk-track.md`; a test fails on an undefined token. Content pack: `npm run content-pack` (a test fails on drift).
- Rule 27: `runObs.js` builds the run's events, one stdout line per decision and the record for the shared panel (all `simulated`); the lab reads no logs. Trace: `runTrace.js` (one step for the app's call, one per provider call).
- Docker: `docker-compose.yml` publishes `127.0.0.1:7836` only, non-root, `restart: unless-stopped`; pinned by `scripts/compose.test.mjs`.
- Not built yet: Real mode, the shelf registry entry, proxy route, submodule pin and release (step 3, owner-gated), Story mode.
- Never-repeat lessons: see the section at the end.

## Never-repeat lessons
- A worktree basename must be unique: `air-test` names its remote folder after it.
- Dockerfile COPY sources must not be excluded by `.dockerignore` (`docs/*` plus `!docs/talk-track.md`); a compose test checks every COPY, and a real OrbStack build proves it.
- `new URL('./x', import.meta.url)` in a server file the web tests import must go through a variable (Vite rewrites the literal).
- A missing `/assets` file is a 404, never `index.html`.
- The first story and talk-track load sends no `vertical` (a default parameter turns `undefined` into a value), so the configured customer vertical and cast overrides reach the page.
- Reset, a mode switch and a vertical change clear the scenario hash, and a page runs a `#fallback/<scenario>` hash only on a deliberate navigation, never on a remount.
- The workspace-id pattern is the same on client and server (`/^[a-z0-9][a-z0-9-]{0,31}$/`), and the random-id fallback fills the array in place (a typed array's `map()` leaves it all zeros).
- Pressing the active Mock button changes nothing (no POST, no reload, the last run stays).
- `npm run reset` takes a workspace id (`PMF_WORKSPACE` or the second argument) and clears that one workspace only.
- The netguard allows a literal IP in `dns.lookup` (a LAN address in `PMF_BIND` resolves through it); a name is still refused and a connect to the literal is still refused.
- A key's shortest timeout (500 ms) is above a healthy call (400 ms): a timeout that can never fire is not accepted.
- Shortcut keys ignore Ctrl/Cmd/Alt, held keys and focused controls (Escape still leaves presenter mode).
- Static scans (the host check, the attribution check) skip `.github/` and the shared attribution script, which name the patterns they search for.
- Before claiming a port, check running containers and compose files (`docker ps`, the `ap-*` labs use 7839 to 7843), not only the registry.
- A box or button wrapper only handles keys when `e.target === e.currentTarget`: a wrapper's `onKeyDown` that handles every Enter or Space bubbling up swallows them from the buttons and inputs inside it (the diagram's Close and Copy link). Prefer a real `<button>` for the label and keep the details beside it, not inside a `role=button`.
- A workspace the server forgot (restart, or more than 20) must not be silent: `X-Workspace-Fresh` tells the tab, which shows a banner and reloads; a deliberate Reset answers 0, so it is never mistaken for a forgotten one.
- A vitest test that opens a diagram box with `userEvent` mouse clicks throws inside React Flow's d3 drag handler (no `view` on the event): use `fireEvent.click` for mouse clicks there; keyboard through `userEvent` is fine.
- A bad `customer.config.json` field is never silent: it is logged at start-up and listed on the Limits page, and the tagline is shown.
- "The server forgot this workspace": decide it from a request SENT after a confirmed response (never by arrival order of parallel first requests); clear the run on screen AND the scenario hash; keep the real result of the request that raised it; a Reset is never a forgotten workspace (the server answers 0); a request that will be refused is validated before the workspace is touched, so it creates and evicts nothing.
