# privilege-model-fallback-LAB

Demo-tier standalone lab, step 1 (engine + API only). Port **7836 PROVISIONAL, not claimed**. Spec: `docs/spec.md`. Source of claims: the 2026-11-21 release notes only; everything else is UNVERIFIED (lab model) and the banner (`server/src/data.js`) says so. Never present anything here as a Ping statement.

- Run `npm start`; test `npm test` (glob); preflight `npm run doctor`; reset `npm run reset`. Node 26. Tests go to the Air: `air-test . -- npm test`.
- Core: `server/src/fallback.js` (the engine: chain, per-model ledger, named refusal), `scenarios.js` (scenarios as data with hand-written expectations), `validate.js` (bounds), `app.js` (one `ROUTES` table), `doctor.js` (one check per scenario), `netguard.js`, `safety.js` (bind, Host 421, same-origin).
- Rules that bite: Mock only, zero outbound (netguard + test). `server/src/model-gateway-sim/` and `health.js` are vendored byte for byte, never edited (pin test + doctor). No credential field anywhere: unknown fields are refused. Refusals are named results (HTTP 200), never blank. No claim about a gateway's own rate-limit refusals and fallback (owner, 2026-11-24). Hosts are `.example`/`.invalid` only. No AI attribution in commits or files.
- Not built yet: web UI (banner, toggle, GatewayTrace, JsonPane, diagram, presenter mode, talk track), Dockerfile/compose, `ci.yml`, shelf entry, content pack, stories, Real mode.
