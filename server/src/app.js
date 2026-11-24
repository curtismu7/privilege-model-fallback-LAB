// One Express app. /api = health, info, mode, chain (the key's config), run, scenarios, scenario, reset.
// One in-memory lab state per WORKSPACE (rule 13, header X-Workspace, default "default"): a key (chain + one ledger per model), a lab clock,
// the last run and a short run log. Scenarios never touch the key. The web page is served from web/dist when it has been built.
// Mock only: there is no Real mode yet, so the toggle's Real side answers 409 with a plain reason (rule 19).
// A refused run is a normal result ({ok:false, refusal}) with HTTP 200: the product's real refusal status is UNVERIFIED, so none is imitated.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { runChecks, allPassed } from './doctor.js';
import { createClock } from './model-gateway-sim/labClock.js';
import { PROVIDER_STATES } from './model-gateway-sim/providerStub.js';
import { createKey, estimateTokens, ledgerSnapshots, runFallback } from './fallback.js';
import { DEFAULT_CHAIN, DEFAULT_PROMPT, SCENARIOS, runScenario, scenarioById } from './scenarios.js';
import { KNOWN_PROVIDERS, LIMITS, onlyKeys, validateConfig, validatePrompt, validateProviderStates } from './validate.js';
import { BANNER, LAB_ID, LAB_MODEL, LAB_NAME, NOT_CLAIMED, REAL_UNAVAILABLE, SOURCED, UNVERIFIED } from './data.js';
import { InputError, refuse } from './errors.js';
import { DEFAULT_PORT } from './safety.js';
import { createWorkspaces, workspaceFrom, WorkspaceError } from './workspaces.js';
import { castForVertical, loadCustomerConfig, publicConfig } from './customer.js';
import { buildStories } from './stories.js';
import { buildTalkTrack } from './talkTrack.js';
import { DIAGRAM_NAMES, buildDiagram, hasDiagram } from './diagramData.js';
import { MAX_RUNS, STREAMS, buildRunRecord, decisionLine, eventsFor } from './runObs.js';
import { exchangesFor } from './runTrace.js';
import { RunObsError } from './runObservability.js';
import pkg from '../package.json' with { type: 'json' };

export const ROUTES = {
  '/api/info': ['GET'],
  '/api/mode': ['GET', 'POST'],
  '/api/chain': ['GET', 'PUT'],
  '/api/run': ['POST'],
  '/api/scenarios': ['GET'],
  '/api/scenario/:id': ['POST'],
  '/api/reset': ['POST'],
  '/api/story': ['GET'],
  '/api/diagram': ['GET'],
  '/api/log': ['GET'],
  '/api/run-observability': ['GET'],
};
// /api/health has its own router (GET only, 405 otherwise).
const ROUTE_TABLE = Object.entries(ROUTES).map(([pattern, methods]) => [new RegExp(`^${pattern.replace(/:[a-z]+/g, '[^/]+')}$`), methods]);

const DEFAULT_CONFIG = () => ({ chain: DEFAULT_CHAIN.map((e) => ({ ...e })), timeoutMs: LIMITS.defaultTimeoutMs });
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

// One workspace's state. `lastRun` is the run the observability panel shows (a live run or a scenario run); `log` is a short summary list.
function createLabState() {
  let config = DEFAULT_CONFIG();
  let clock = createClock(0);
  let key = createKey(config, clock);
  let seq = 0;
  return {
    config: () => config,
    key: () => key,
    clock: () => clock,
    configure(next) { config = next; key = createKey(config, clock); }, // new ledgers, same clock
    nextRunId: () => `run-${++seq}`,
    lastRun: null,
    log: [],
  };
}

const sayLine = (line) => process.stdout.write(`${line}\n`);

export function createApp({
  health = createHealth({ demoId: LAB_ID, demoName: LAB_NAME, version: pkg.version, runChecks, allPassed }),
  env = process.env, customer = loadCustomerConfig({ env }), log = sayLine, now = Date.now, distDir = DIST,
} = {}) {
  const workspaces = createWorkspaces({ build: () => createLabState() });
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    next();
  });

  const api = express.Router();
  api.use('/health', health.router);
  // Wrong method on a known path: 405 with Allow.
  api.use((req, res, next) => {
    for (const [re, methods] of ROUTE_TABLE) {
      if (re.test(`/api${req.path}`) && !methods.includes(req.method)) return res.set('Allow', methods.join(', ')).status(405).json({ error: 'method_not_allowed', message: `Use ${methods.join(' or ')} here` });
    }
    next();
  });
  // The body is parsed only for a method the route accepts: a wrong method with a bad body is a 405, not a 400 about the body.
  api.use(express.json({ limit: '256kb' }));
  // The workspace of a request (rule 13): a bad X-Workspace is a 400 with a message, never silently the default.
  // X-Workspace-Fresh says whether this request had to CREATE the workspace (1) or found it (0): a tab that already used its id and now gets 1 knows the server
  // forgot it (restart, or more than 20 workspaces) and that it is looking at the defaults.
  const wsOf = (req, res) => { const { ws, created } = workspaces.acquire(workspaceFrom(req)); res.set('X-Workspace-Fresh', created ? '1' : '0'); return ws; };

  // Every run, live or scenario, leaves the same things behind: one stdout line per decision, the last-run record for the panel and a log line.
  function recordRun(ws, { kind, scenarioId = null, prompt, result }) {
    const runId = ws.nextRunId();
    const baseMs = now();
    const events = eventsFor(result, { needed: estimateTokens(prompt), baseMs });
    for (const e of events) log(decisionLine(e, runId));
    ws.lastRun = { id: runId, startedAt: new Date(baseMs).toISOString(), endedAt: new Date(baseMs + result.totals.latencyMs).toISOString(), events, kind, scenarioId };
    ws.log = [{ runId, at: ws.lastRun.startedAt, kind, scenarioId, ok: result.ok, servedBy: result.servedBy ? `${result.servedBy.provider}/${result.servedBy.model}` : null, refusal: result.refusal?.code ?? null, attempts: result.totals.attempts }, ...ws.log].slice(0, MAX_RUNS);
    return { runId, trace: { exchanges: exchangesFor(result, { prompt, needed: estimateTokens(prompt) }) } };
  }

  const chainView = (ws) => ({
    chain: ws.config().chain, timeoutMs: ws.config().timeoutMs, ledgers: ledgerSnapshots(ws.key()), clockMs: ws.clock().now(),
    limits: LIMITS, knownProviders: KNOWN_PROVIDERS, providerStates: PROVIDER_STATES,
  });

  api.get('/info', (req, res) => res.json({
    lab: LAB_NAME, id: LAB_ID, version: pkg.version, tier: 'Demo', source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE,
    banner: BANNER, sourced: SOURCED, labModel: LAB_MODEL, unverified: UNVERIFIED, notClaimed: NOT_CLAIMED, defaultPrompt: DEFAULT_PROMPT, limits: LIMITS, workspace: workspaceFrom(req), name: customer.config.name,
  }));

  api.get('/mode', (_req, res) => res.json({ source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE }));
  api.post('/mode', (req, res) => {
    onlyKeys(req.body, ['source'], 'the mode request');
    if (req.body.source === 'mock') return res.json({ source: 'mock' });
    if (req.body.source === 'real') return res.status(409).json({ error: 'real_unavailable', message: REAL_UNAVAILABLE, source: 'mock' });
    throw refuse('bad_source', 'source must be "mock" or "real"');
  });

  api.get('/chain', (req, res) => res.json(chainView(wsOf(req, res))));
  api.put('/chain', (req, res) => { const ws = wsOf(req, res); ws.configure(validateConfig(req.body)); res.json(chainView(ws)); });

  api.post('/run', (req, res) => {
    const ws = wsOf(req, res);
    onlyKeys(req.body, ['prompt', 'providerStates'], 'the run request');
    validatePrompt(req.body.prompt);
    const key = ws.key();
    validateProviderStates(req.body.providerStates, key.entries.length);
    const result = runFallback(key, req.body.prompt, ws.clock(), { providerStates: req.body.providerStates });
    res.json({ ...result, clockMs: ws.clock().now(), ...recordRun(ws, { kind: 'live', prompt: req.body.prompt, result }) });
  });

  api.get('/scenarios', (_req, res) => res.json({ scenarios: SCENARIOS.map(({ id, title, summary, chain, timeoutMs, providerStates, preSpend, prompt, expect }) => ({ id, title, summary, chain, timeoutMs, providerStates, preSpend, prompt, expect })) }));
  api.post('/scenario/:id', (req, res) => {
    const ws = wsOf(req, res);
    const sc = scenarioById(req.params.id);
    if (!sc) throw refuse('unknown_scenario', 'no scenario with that id', 404);
    const out = runScenario(sc.id);
    res.json({ ...out, ...recordRun(ws, { kind: 'scenario', scenarioId: sc.id, prompt: sc.prompt, result: out.result }) });
  });

  // The vertical packs and customer.config (rules 10 and 12): stories and the talk track with the cast filled in. ?vertical= picks a pack.
  api.get('/story', (req, res) => {
    const pick = castForVertical(customer, req.query.vertical);
    if (!pick) throw refuse('unknown_vertical', 'no such vertical', 400);
    res.json({ ...publicConfig(customer), vertical: pick.vertical, cast: pick.cast, stories: buildStories(pick.cast), talkTrack: buildTalkTrack(pick.cast), banner: BANNER, unverified: UNVERIFIED });
  });

  // Rule 17: the diagram by name, from diagram-studio data.
  api.get('/diagram', (req, res) => {
    const name = req.query.name === undefined ? DIAGRAM_NAMES[0] : req.query.name;
    if (!hasDiagram(name)) throw refuse('unknown_diagram', `no diagram with that name; the lab has: ${DIAGRAM_NAMES.join(', ')}`, 404);
    const pick = castForVertical(customer, req.query.vertical);
    if (!pick) throw refuse('unknown_vertical', 'no such vertical', 400);
    res.json(buildDiagram(pick.cast, name));
  });

  // Rule 27: what the last run of this workspace left behind. null before any run.
  api.get('/run-observability', async (req, res, next) => {
    try { const ws = wsOf(req, res); res.json({ record: await buildRunRecord(ws.lastRun, { clock: now }), run: ws.lastRun ? { id: ws.lastRun.id, kind: ws.lastRun.kind, scenarioId: ws.lastRun.scenarioId } : null, streams: STREAMS }); }
    catch (e) { next(e); }
  });
  api.get('/log', (req, res) => res.json({ runs: wsOf(req, res).log }));

  // Reset clears this workspace only (its key, clock, last run and log) and starts it again fresh: a deliberate reset is not a forgotten workspace (Fresh 0).
  api.post('/reset', (req, res) => {
    const id = workspaceFrom(req);
    workspaces.reset(id);
    const { ws } = workspaces.acquire(id);
    res.set('X-Workspace-Fresh', '0');
    res.json({ reset: true, workspace: id, ...chainView(ws) });
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));
  app.use('/api', api);

  // The built web page (web/dist), when there is one: tests and the doctor run without it. Any other GET gets index.html (hash routing needs only /).
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir, { index: false, fallthrough: true }));
    app.get(/^\/(?!api(\/|$)|assets\/).*/, (_req, res) => res.sendFile(indexHtml)); // a missing /assets file is a 404, never the page (an HTML body parsed as a script is a silent blank page)
  }
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found. The web page is not built here (npm run build); the API is under /api.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof WorkspaceError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof RunObsError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'The body is not valid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'The body is too large' });
    if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') return res.status(415).json({ error: 'unsupported_encoding', message: 'Send the body as utf-8 JSON' });
    return res.status(500).json({ error: 'internal', message: 'The lab hit an internal error' });
  });
  app._health = health; // for tests and the doctor to stop the background timer
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}

export { DEFAULT_PORT };
