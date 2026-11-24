// The fallback engine. A key has an ordered chain of models (primary first). A call tries them in order and the first that answers wins:
//   - a model is skipped when its OWN ledger cannot cover the call (out of budget): no provider call, no latency;
//   - a model that fails (down 503, overloaded 429, timeout 504, all provider-origin) is skipped;
//   - each model has its own ledger, charged only when that model serves.
// If no model answers the result is a NAMED refusal that says which budgets ran out and which providers failed, never a blank.
// Deterministic: no network, no randomness, time only from the lab clock. The behaviour is THIS LAB'S MODEL, UNVERIFIED against the
// product beyond the 2026-11-21 release notes. Not modelled (no claim either way): retry before fallback, mid-stream failure, the guard
// on a fallback's answer, and a gateway's own rate-limit refusals.
import { createProvider } from './model-gateway-sim/providerStub.js';
import { createLlmKey } from './model-gateway-sim/llmKey.js';
import { validatePrompt, validateProviderStates } from './validate.js';

export const LATENCY_MS = 400;
export const REPLY_TOKENS = 120;

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
// What a call is expected to cost: the provider stub charges input words plus a fixed reply, so the estimate equals the charge.
export const estimateTokens = (prompt) => wordCount(prompt) + REPLY_TOKENS;

const REASON = { provider_unavailable: 'provider_down', provider_overloaded: 'provider_overloaded', provider_timeout: 'provider_timeout' };
const WHY = {
  provider_down: 'is down (503)',
  provider_overloaded: 'is overloaded (429 from the provider)',
  provider_timeout: 'timed out (504)',
};

// chain: [{provider, model, budgetTokens}] (already validated). One provider stub and one ledger per entry; the clock is shared.
export function createKey({ chain, timeoutMs }, clock) {
  const entries = chain.map(({ provider, model, budgetTokens }) => ({
    provider, model, budgetTokens,
    stub: createProvider({ id: provider, model, latencyMs: LATENCY_MS, timeoutMs, replyTokens: REPLY_TOKENS }, clock),
    llm: createLlmKey({ id: `${provider}/${model}`, budgetTokens }),
  }));
  return { id: 'key-1', timeoutMs, clock, entries };
}

export function ledgerSnapshots(key) {
  return key.entries.map((e, position) => ({
    position, provider: e.provider, model: e.model,
    limit: e.llm.ledger.limit, spent: e.llm.ledger.spent(), remaining: e.llm.ledger.remaining(),
  }));
}

function refusalFor(key, attempts, needed) {
  const snaps = ledgerSnapshots(key);
  const budgetsExhausted = attempts.filter((a) => a.reason === 'out_of_budget' || a.reason === 'budget_exceeded_after_call')
    .map((a) => ({ provider: a.provider, model: a.model, limit: snaps[a.position].limit, spent: snaps[a.position].spent, remaining: snaps[a.position].remaining, neededTokens: needed }));
  const providersFailed = attempts.filter((a) => a.origin === 'provider').map((a) => ({ provider: a.provider, model: a.model, status: a.status, error: a.error }));
  const single = key.entries.length === 1;
  const code = single ? 'no_fallback_configured'
    : budgetsExhausted.length === attempts.length ? 'all_budgets_exhausted'
      : providersFailed.length === attempts.length ? 'all_providers_failed' : 'chain_exhausted';
  const parts = attempts.map((a) => {
    const s = snaps[a.position];
    return `${a.provider}/${a.model} ${a.origin === 'provider' ? WHY[a.reason] : `is out of budget (${s.remaining} of ${s.limit} tokens left, this call needs about ${needed})`}`;
  });
  const message = `No model could answer: ${parts.join('; ')}.${single ? ' This key has no fallback model configured.' : ''}`;
  return { code, message, fallbackConfigured: !single, budgetsExhausted, providersFailed };
}

export function runFallback(key, prompt, clock, { providerStates } = {}) {
  if (!key || key.clock !== clock) throw new TypeError('the key must be built on the same lab clock');
  validatePrompt(prompt);
  const states = validateProviderStates(providerStates, key.entries.length);
  key.entries.forEach((e, i) => e.stub.setState(states[i]));

  const startedAt = clock.now();
  const needed = estimateTokens(prompt);
  const attempts = [];
  let served = null;
  let answer = null;

  for (let position = 0; position < key.entries.length; position++) {
    const e = key.entries[position];
    const base = { position, provider: e.provider, model: e.model };
    const ledger = e.llm.ledger;
    // A zero-token spend always succeeds in the kit, so "out of budget" is decided here from remaining() and the expected cost.
    if (ledger.remaining() <= 0 || !ledger.canSpend(needed)) {
      attempts.push({ ...base, ok: false, status: null, error: 'out_of_budget', origin: 'key-budget', latencyMs: 0, tokens: 0, reason: 'out_of_budget' });
      continue;
    }
    const r = e.stub.call({ prompt });
    if (!r.ok) {
      attempts.push({ ...base, ok: false, status: r.status, error: r.error, origin: r.origin, latencyMs: r.latencyMs, tokens: 0, reason: REASON[r.error] });
      continue;
    }
    const tokens = r.usage.inputTokens + r.usage.outputTokens;
    // The ledger never overdraws; a refused charge means the call is not served by this model (cannot happen while estimate equals charge).
    if (!ledger.spend(tokens)) {
      attempts.push({ ...base, ok: false, status: r.status, error: 'budget_exceeded_after_call', origin: 'key-budget', latencyMs: r.latencyMs, tokens: 0, reason: 'budget_exceeded_after_call' });
      continue;
    }
    e.llm.usage.record();
    attempts.push({ ...base, ok: true, status: r.status, error: null, origin: null, latencyMs: r.latencyMs, tokens, reason: 'served' });
    served = { position, provider: e.provider, model: e.model };
    answer = r.text;
    break;
  }

  return {
    ok: served !== null,
    servedBy: served,
    answer,
    attempts,
    totals: {
      attempts: attempts.length,
      fallbackUsed: served !== null && served.position > 0,
      latencyMs: clock.now() - startedAt,
      tokensCharged: attempts.reduce((n, a) => n + a.tokens, 0),
    },
    ledgers: ledgerSnapshots(key),
    refusal: served ? null : refusalFor(key, attempts, needed),
    clock: { startedAt, endedAt: clock.now() },
  };
}
