// Scenarios as DATA. Each has the key's chain, the state of each model, an optional pre-spend (tokens already used), and an EXPECTED result
// written by hand (never computed from the engine), so a test and `npm run doctor` can both tell when the engine drifts.
// Every scenario runs on a fresh key and a fresh lab clock: it never touches the live key.
// The prompt costs 128 tokens (8 words + the stub's 120-token reply); a healthy call costs 400 ms, a down or overloaded refusal 20 ms.
import { createClock } from './model-gateway-sim/labClock.js';
import { createKey, runFallback } from './fallback.js';

export const DEFAULT_PROMPT = 'Summarise the open support cases for this week.';
export const DEFAULT_CHAIN = Object.freeze([
  Object.freeze({ provider: 'provider-a', model: 'model-a-large', budgetTokens: 1000 }),
  Object.freeze({ provider: 'provider-a', model: 'model-a-small', budgetTokens: 500 }),
]);

const TWO = DEFAULT_CHAIN.map((e) => ({ ...e }));

export const SCENARIOS = Object.freeze([
  {
    id: 'primary-healthy',
    title: 'Primary healthy',
    summary: 'The primary model answers. The fallback is never tried, so the trace has one attempt.',
    chain: TWO, timeoutMs: 3000, providerStates: ['healthy', 'healthy'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 0, reasons: ['served'], refusalCode: null, spent: [128, 0], elapsedMs: 400 },
  },
  {
    id: 'primary-down',
    title: 'Primary down',
    summary: 'The primary answers 503. The fallback answers and the response names it. Both attempts are in the trace with their latency.',
    chain: TWO, timeoutMs: 3000, providerStates: ['down', 'healthy'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 1, reasons: ['provider_down', 'served'], refusalCode: null, spent: [0, 128], elapsedMs: 420 },
  },
  {
    id: 'primary-overloaded',
    title: 'Primary overloaded',
    summary: 'The primary answers 429 (the lab\'s model of "overloaded", UNVERIFIED). The fallback answers.',
    chain: TWO, timeoutMs: 3000, providerStates: ['overloaded', 'healthy'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 1, reasons: ['provider_overloaded', 'served'], refusalCode: null, spent: [0, 128], elapsedMs: 420 },
  },
  {
    id: 'primary-out-of-budget',
    title: 'Primary out of budget',
    summary: 'The primary has 100 of 1000 tokens left and the call needs about 128, so it is skipped without a provider call. The fallback answers and is charged on its own ledger.',
    chain: TWO, timeoutMs: 3000, providerStates: ['healthy', 'healthy'], preSpend: [{ position: 0, tokens: 900 }], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 1, reasons: ['out_of_budget', 'served'], refusalCode: null, spent: [900, 128], elapsedMs: 400 },
  },
  {
    id: 'fallback-different-provider',
    title: 'Fallback on a different provider',
    summary: 'The primary is down; the fallback is a model on another provider and serves.',
    chain: [TWO[0], { provider: 'provider-b', model: 'model-b-small', budgetTokens: 500 }], timeoutMs: 3000, providerStates: ['down', 'healthy'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 1, reasons: ['provider_down', 'served'], refusalCode: null, spent: [0, 128], elapsedMs: 420, servedProvider: 'provider-b' },
  },
  {
    id: 'both-budgets-exhausted',
    title: 'Both budgets exhausted',
    summary: 'Neither model can pay for the call. The answer is a named refusal that says which budgets ran out; no provider is called and nothing is charged.',
    chain: TWO, timeoutMs: 3000, providerStates: ['healthy', 'healthy'], preSpend: [{ position: 0, tokens: 900 }, { position: 1, tokens: 450 }], prompt: DEFAULT_PROMPT,
    expect: { ok: false, servedPosition: null, reasons: ['out_of_budget', 'out_of_budget'], refusalCode: 'all_budgets_exhausted', spent: [900, 450], elapsedMs: 0 },
  },
  {
    id: 'both-providers-down',
    title: 'Both models down',
    summary: 'The primary and the fallback both fail. A named refusal lists both providers and their status codes.',
    chain: TWO, timeoutMs: 3000, providerStates: ['down', 'overloaded'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: false, servedPosition: null, reasons: ['provider_down', 'provider_overloaded'], refusalCode: 'all_providers_failed', spent: [0, 0], elapsedMs: 40 },
  },
  {
    id: 'one-model-chain',
    title: 'One-model chain (no fallback configured)',
    summary: 'A key with a single model and no fallback. When it is down the refusal says no fallback is configured.',
    chain: [TWO[0]], timeoutMs: 3000, providerStates: ['down'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: false, servedPosition: null, reasons: ['provider_down'], refusalCode: 'no_fallback_configured', spent: [0], elapsedMs: 20 },
  },
  {
    id: 'slow-primary-timeout',
    title: 'Slow primary hits the timeout',
    summary: 'The primary is slow (10x latency, 4000 ms) and the key\'s timeout is 3000 ms, so the call times out (504) after 3000 ms. The fallback answers.',
    chain: TWO, timeoutMs: 3000, providerStates: ['slow', 'healthy'], preSpend: [], prompt: DEFAULT_PROMPT,
    expect: { ok: true, servedPosition: 1, reasons: ['provider_timeout', 'served'], refusalCode: null, spent: [0, 128], elapsedMs: 3400 },
  },
]);

const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
export const scenarioById = (id) => (typeof id === 'string' ? byId.get(id) ?? null : null);

// Compares a result with the scenario's hand-written expectation. Returns the list of mismatches (empty = pass).
export function checkExpectation(result, expect) {
  const bad = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
  eq('ok', result.ok, expect.ok);
  eq('servedPosition', result.servedBy ? result.servedBy.position : null, expect.servedPosition);
  eq('reasons', result.attempts.map((a) => a.reason), expect.reasons);
  eq('refusalCode', result.refusal ? result.refusal.code : null, expect.refusalCode);
  eq('spent', result.ledgers.map((l) => l.spent), expect.spent);
  eq('elapsedMs', result.totals.latencyMs, expect.elapsedMs);
  if (expect.servedProvider !== undefined) eq('servedProvider', result.servedBy ? result.servedBy.provider : null, expect.servedProvider);
  // A refusal must name every model it could not use; a served result carries no refusal.
  if (!expect.ok) {
    const names = result.attempts.map((a) => `${a.provider}/${a.model}`);
    if (!result.refusal || !names.every((n) => result.refusal.message.includes(n))) bad.push('refusal message does not name every model that failed');
  } else if (result.refusal !== null) bad.push('a served result must carry no refusal');
  return bad;
}

export function runScenario(id) {
  const s = scenarioById(id);
  if (!s) return null;
  const clock = createClock(0);
  const key = createKey({ chain: s.chain, timeoutMs: s.timeoutMs }, clock);
  for (const { position, tokens } of s.preSpend) key.entries[position].llm.ledger.spend(tokens);
  const result = runFallback(key, s.prompt, clock, { providerStates: s.providerStates });
  const mismatches = checkExpectation(result, s.expect);
  return { id: s.id, title: s.title, summary: s.summary, expect: s.expect, pass: mismatches.length === 0, mismatches, result };
}
