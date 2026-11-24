// One Express app. /api = health, info, mode, chain (the key's config), run, scenarios, scenario, reset.
// One in-memory lab state per process: a key (chain + one ledger per model) and a lab clock. Scenarios never touch it.
// Mock only: there is no Real mode yet, so the toggle's Real side answers 409 with a plain reason (rule 19).
// A refused run is a normal result ({ok:false, refusal}) with HTTP 200: the product's real refusal status is UNVERIFIED, so none is imitated.
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { runChecks, allPassed } from './doctor.js';
import { createClock } from './model-gateway-sim/labClock.js';
import { PROVIDER_STATES } from './model-gateway-sim/providerStub.js';
import { createKey, ledgerSnapshots, runFallback } from './fallback.js';
import { DEFAULT_CHAIN, DEFAULT_PROMPT, SCENARIOS, runScenario, scenarioById } from './scenarios.js';
import { KNOWN_PROVIDERS, LIMITS, onlyKeys, validateConfig, validatePrompt, validateProviderStates } from './validate.js';
import { BANNER, LAB_ID, LAB_NAME, REAL_UNAVAILABLE, UNVERIFIED } from './data.js';
import { InputError, refuse } from './errors.js';
import { DEFAULT_PORT } from './safety.js';
import pkg from '../package.json' with { type: 'json' };

export const ROUTES = {
  '/api/info': ['GET'],
  '/api/mode': ['GET', 'POST'],
  '/api/chain': ['GET', 'PUT'],
  '/api/run': ['POST'],
  '/api/scenarios': ['GET'],
  '/api/scenario/:id': ['POST'],
  '/api/reset': ['POST'],
};
// /api/health has its own router (GET only, 405 otherwise).
const ROUTE_TABLE = Object.entries(ROUTES).map(([pattern, methods]) => [new RegExp(`^${pattern.replace(/:[a-z]+/g, '[^/]+')}$`), methods]);

const DEFAULT_CONFIG = () => ({ chain: DEFAULT_CHAIN.map((e) => ({ ...e })), timeoutMs: LIMITS.defaultTimeoutMs });

function createLabState() {
  let config = DEFAULT_CONFIG();
  let clock = createClock(0);
  let key = createKey(config, clock);
  return {
    config: () => config,
    key: () => key,
    clock: () => clock,
    configure(next) { config = next; key = createKey(config, clock); }, // new ledgers, same clock
    reset() { config = DEFAULT_CONFIG(); clock = createClock(0); key = createKey(config, clock); },
  };
}

export function createApp({ health = createHealth({ demoId: LAB_ID, demoName: LAB_NAME, version: pkg.version, runChecks, allPassed }), env = process.env } = {}) {
  void env;
  const state = createLabState();
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });

  const api = express.Router();
  api.use('/health', health.router);
  api.use(express.json({ limit: '256kb' }));
  // Wrong method on a known path: 405 with Allow.
  api.use((req, res, next) => {
    for (const [re, methods] of ROUTE_TABLE) {
      if (re.test(`/api${req.path}`) && !methods.includes(req.method)) return res.set('Allow', methods.join(', ')).status(405).json({ error: 'method_not_allowed', message: `Use ${methods.join(' or ')} here` });
    }
    next();
  });

  const chainView = () => ({
    chain: state.config().chain, timeoutMs: state.config().timeoutMs, ledgers: ledgerSnapshots(state.key()), clockMs: state.clock().now(),
    limits: LIMITS, knownProviders: KNOWN_PROVIDERS, providerStates: PROVIDER_STATES,
  });

  api.get('/info', (_req, res) => res.json({
    lab: LAB_NAME, id: LAB_ID, version: pkg.version, tier: 'Demo', source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE,
    banner: BANNER, unverified: UNVERIFIED, defaultPrompt: DEFAULT_PROMPT, limits: LIMITS,
  }));

  api.get('/mode', (_req, res) => res.json({ source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE }));
  api.post('/mode', (req, res) => {
    onlyKeys(req.body, ['source'], 'the mode request');
    if (req.body.source === 'mock') return res.json({ source: 'mock' });
    if (req.body.source === 'real') return res.status(409).json({ error: 'real_unavailable', message: REAL_UNAVAILABLE, source: 'mock' });
    throw refuse('bad_source', 'source must be "mock" or "real"');
  });

  api.get('/chain', (_req, res) => res.json(chainView()));
  api.put('/chain', (req, res) => { state.configure(validateConfig(req.body)); res.json(chainView()); });

  api.post('/run', (req, res) => {
    onlyKeys(req.body, ['prompt', 'providerStates'], 'the run request');
    validatePrompt(req.body.prompt);
    const key = state.key();
    validateProviderStates(req.body.providerStates, key.entries.length);
    res.json({ ...runFallback(key, req.body.prompt, state.clock(), { providerStates: req.body.providerStates }), clockMs: state.clock().now() });
  });

  api.get('/scenarios', (_req, res) => res.json({ scenarios: SCENARIOS.map(({ id, title, summary, chain, timeoutMs, providerStates, preSpend, prompt, expect }) => ({ id, title, summary, chain, timeoutMs, providerStates, preSpend, prompt, expect })) }));
  api.post('/scenario/:id', (req, res) => {
    if (!scenarioById(req.params.id)) throw refuse('unknown_scenario', 'no scenario with that id', 404);
    res.json(runScenario(req.params.id));
  });

  api.post('/reset', (_req, res) => { state.reset(); res.json({ reset: true, ...chainView() }); });

  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));
  app.use('/api', api);
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found. The web page is built in a later step; use /api/info.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code, message: err.message });
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
