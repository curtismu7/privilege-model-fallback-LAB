import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/model-gateway-sim/labClock.js';
import { createKey, runFallback, estimateTokens } from '../src/fallback.js';
import { DEFAULT_CHAIN, DEFAULT_PROMPT } from '../src/scenarios.js';

const make = (chain = DEFAULT_CHAIN, timeoutMs = 3000) => { const clock = createClock(0); return { clock, key: createKey({ chain: chain.map((e) => ({ ...e })), timeoutMs }, clock) }; };
const run = (m, states, prompt = DEFAULT_PROMPT) => runFallback(m.key, prompt, m.clock, { providerStates: states });
const spend = (m, pos, n) => assert.equal(m.key.entries[pos].llm.ledger.spend(n), true);

test('healthy primary serves and the fallback is never attempted', () => {
  const m = make();
  const r = run(m);
  assert.equal(r.ok, true);
  assert.deepEqual(r.servedBy, { position: 0, provider: 'provider-a', model: 'model-a-large' });
  assert.equal(r.attempts.length, 1);
  assert.equal(r.totals.fallbackUsed, false);
  assert.match(r.answer, /^\[model-a-large\] answer to: /);
});

for (const [state, status, reason] of [['down', 503, 'provider_down'], ['overloaded', 429, 'provider_overloaded'], ['timeout', 504, 'provider_timeout']]) {
  test(`primary ${state}: the fallback serves, both attempts are traced with latency`, () => {
    const m = make();
    const r = run(m, [state, 'healthy']);
    assert.equal(r.ok, true);
    assert.equal(r.servedBy.model, 'model-a-small');
    assert.equal(r.totals.fallbackUsed, true);
    assert.equal(r.attempts.length, 2);
    assert.equal(r.attempts[0].ok, false);
    assert.equal(r.attempts[0].status, status);
    assert.equal(r.attempts[0].reason, reason);
    assert.equal(r.attempts[0].origin, 'provider');
    assert.ok(r.attempts[0].latencyMs > 0 && r.attempts[1].latencyMs > 0);
    assert.equal(r.attempts[1].reason, 'served');
    assert.equal(r.totals.latencyMs, r.attempts[0].latencyMs + r.attempts[1].latencyMs);
  });
}

test('primary out of budget: the fallback serves; the primary is skipped with no provider call and no latency', () => {
  const m = make();
  spend(m, 0, 900); // 100 of 1000 left, the call needs 128
  const r = run(m);
  assert.equal(r.ok, true);
  assert.equal(r.servedBy.position, 1);
  assert.deepEqual({ reason: r.attempts[0].reason, latency: r.attempts[0].latencyMs, tokens: r.attempts[0].tokens, status: r.attempts[0].status, origin: r.attempts[0].origin }, { reason: 'out_of_budget', latency: 0, tokens: 0, status: null, origin: 'key-budget' });
  assert.equal(m.key.entries[0].stub.getState(), 'healthy');
});

test('fallback is charged to its own ledger, never the primary\'s', () => {
  const m = make();
  const r = run(m, ['down', 'healthy']);
  assert.equal(estimateTokens(DEFAULT_PROMPT), 128);
  assert.deepEqual(r.ledgers.map((l) => l.spent), [0, 128]);
  assert.deepEqual(r.ledgers.map((l) => l.remaining), [1000, 372]);
  // and the primary serving charges only the primary
  const m2 = make();
  assert.deepEqual(run(m2).ledgers.map((l) => l.spent), [128, 0]);
});

test('the charge equals the estimate used for the budget check (no drift between the two)', () => {
  for (const prompt of ['one', 'a  b\tc\nd', 'x '.repeat(500)]) {
    const m = make([{ provider: 'provider-a', model: 'm', budgetTokens: 100000 }]);
    const r = runFallback(m.key, prompt, m.clock);
    assert.equal(r.attempts[0].tokens, estimateTokens(prompt));
  }
});

test('a fallback on a different provider serves', () => {
  const m = make([DEFAULT_CHAIN[0], { provider: 'provider-b', model: 'model-b-small', budgetTokens: 500 }]);
  const r = run(m, ['down', 'healthy']);
  assert.equal(r.servedBy.provider, 'provider-b');
  assert.match(r.answer, /^\[model-b-small\]/);
});

test('the labelled Bedrock assumed-role stub works as a fallback target', () => {
  const m = make([DEFAULT_CHAIN[0], { provider: 'bedrock-assumed-role-stub', model: 'bedrock-model-stub', budgetTokens: 500 }]);
  assert.equal(run(m, ['overloaded', 'healthy']).servedBy.provider, 'bedrock-assumed-role-stub');
});

test('both budgets exhausted: a NAMED refusal naming each budget, no provider called, nothing charged, never blank', () => {
  const m = make();
  spend(m, 0, 900); spend(m, 1, 450);
  const r = run(m);
  assert.equal(r.ok, false);
  assert.equal(r.servedBy, null);
  assert.equal(r.answer, null);
  assert.equal(r.refusal.code, 'all_budgets_exhausted');
  assert.match(r.refusal.message, /provider-a\/model-a-large is out of budget \(100 of 1000 tokens left/);
  assert.match(r.refusal.message, /provider-a\/model-a-small is out of budget \(50 of 500 tokens left/);
  assert.deepEqual(r.refusal.budgetsExhausted.map((b) => b.model), ['model-a-large', 'model-a-small']);
  assert.deepEqual(r.refusal.providersFailed, []);
  assert.equal(r.refusal.fallbackConfigured, true);
  assert.equal(r.totals.latencyMs, 0);
  assert.deepEqual(r.ledgers.map((l) => l.spent), [900, 450]);
});

test('both providers down: a named refusal listing both providers and status codes', () => {
  const m = make();
  const r = run(m, ['down', 'overloaded']);
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, 'all_providers_failed');
  assert.deepEqual(r.refusal.providersFailed.map((p) => [p.model, p.status]), [['model-a-large', 503], ['model-a-small', 429]]);
  assert.match(r.refusal.message, /model-a-large is down \(503\).*model-a-small is overloaded \(429/);
  assert.deepEqual(r.ledgers.map((l) => l.spent), [0, 0]);
});

test('mixed failure (primary down, fallback out of budget) names both kinds', () => {
  const m = make();
  spend(m, 1, 450);
  const r = run(m, ['down', 'healthy']);
  assert.equal(r.refusal.code, 'chain_exhausted');
  assert.equal(r.refusal.budgetsExhausted.length, 1);
  assert.equal(r.refusal.providersFailed.length, 1);
  assert.match(r.refusal.message, /model-a-large is down.*model-a-small is out of budget/);
});

test('a one-model chain: when it fails the refusal says no fallback is configured', () => {
  const m = make([DEFAULT_CHAIN[0]]);
  const r = run(m, ['down']);
  assert.equal(r.refusal.code, 'no_fallback_configured');
  assert.equal(r.refusal.fallbackConfigured, false);
  assert.match(r.refusal.message, /no fallback model configured/);
  const ok = make([DEFAULT_CHAIN[0]]);
  assert.equal(run(ok).ok, true);
});

test('zero-token budget: out of budget at once (a zero-cost spend would succeed in the kit, so remaining() decides), never overdrawn', () => {
  const m = make([{ provider: 'provider-a', model: 'zero', budgetTokens: 0 }, { provider: 'provider-b', model: 'ok', budgetTokens: 500 }]);
  assert.equal(m.key.entries[0].llm.ledger.spend(0), true, 'kit semantics: a zero spend is a no-op that succeeds');
  const r = run(m);
  assert.equal(r.attempts[0].reason, 'out_of_budget');
  assert.equal(r.servedBy.model, 'ok');
  assert.equal(r.ledgers[0].spent, 0);
});

test('a ledger never overdraws across many runs', () => {
  const m = make([{ provider: 'provider-a', model: 'm', budgetTokens: 400 }]);
  const outcomes = [];
  for (let i = 0; i < 6; i++) outcomes.push(runFallback(m.key, DEFAULT_PROMPT, m.clock).ok);
  assert.deepEqual(outcomes, [true, true, true, false, false, false]); // 3 x 128 = 384 of 400; the 4th would need 512
  assert.equal(m.key.entries[0].llm.ledger.spent(), 384);
  assert.ok(m.key.entries[0].llm.ledger.remaining() >= 0);
});

test('a budget that covers exactly one call: the second is refused and the leftover stays', () => {
  const m = make([{ provider: 'provider-a', model: 'm', budgetTokens: 128 }]);
  assert.equal(runFallback(m.key, DEFAULT_PROMPT, m.clock).ok, true);
  assert.equal(m.key.entries[0].llm.ledger.remaining(), 0);
  assert.equal(runFallback(m.key, DEFAULT_PROMPT, m.clock).refusal.code, 'no_fallback_configured');
});

test('slow primary: over the timeout it times out (504) and falls back; under the timeout it serves slowly', () => {
  const m = make(DEFAULT_CHAIN, 3000);
  const r = run(m, ['slow', 'healthy']);
  assert.deepEqual([r.attempts[0].reason, r.attempts[0].status, r.attempts[0].latencyMs], ['provider_timeout', 504, 3000]);
  assert.equal(r.servedBy.position, 1);
  const m2 = make(DEFAULT_CHAIN, 5000);
  const r2 = run(m2, ['slow', 'healthy']);
  assert.equal(r2.servedBy.position, 0);
  assert.equal(r2.attempts[0].latencyMs, 4000);
});

test('the lab clock never goes backwards and advances by the attempts\' latency', () => {
  const m = make();
  const a = run(m, ['down', 'healthy']);
  const b = run(m, ['healthy', 'healthy']);
  assert.equal(a.clock.endedAt, 420);
  assert.equal(b.clock.startedAt, 420);
  assert.equal(b.clock.endedAt, 820);
});

test('the key has no credential field and the result carries none', () => {
  const m = make();
  const dump = JSON.stringify([m.key.entries.map((e) => e.llm), run(m)]);
  assert.doesNotMatch(dump, /secret|apiKey|api_key|password|credential|token":"/i);
});

test('engine refuses a key built on another clock, a blank, oversize or non-string prompt', () => {
  const m = make();
  assert.throws(() => runFallback(m.key, DEFAULT_PROMPT, createClock(0)), TypeError);
  for (const p of ['', '   ', 'x'.repeat(20001), 42, null, undefined, {}]) assert.throws(() => runFallback(m.key, p, m.clock), (e) => e.status === 400);
  assert.equal(runFallback(m.key, 'x'.repeat(20000), m.clock).ok, true);
});

test('unknown provider state is refused', () => {
  const m = make();
  assert.throws(() => run(m, ['broken', 'healthy']), (e) => e.code === 'unknown_provider_state');
  assert.throws(() => run(m, ['healthy', 'healthy', 'healthy']), (e) => e.code === 'bad_provider_states');
});
