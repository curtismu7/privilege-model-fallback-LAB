import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, checkExpectation, runScenario, scenarioById } from '../src/scenarios.js';

test('the scenario table has the nine scenarios, unique ids, every one with an expected result', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), [
    'primary-healthy', 'primary-down', 'primary-overloaded', 'primary-out-of-budget', 'fallback-different-provider',
    'both-budgets-exhausted', 'both-providers-down', 'one-model-chain', 'slow-primary-timeout',
  ]);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const s of SCENARIOS) assert.ok(s.expect && s.title && s.summary, s.id);
});

// One test per scenario: the engine gives the hand-written expectation.
for (const s of SCENARIOS) {
  test(`scenario ${s.id}: ${s.title}`, () => {
    const r = runScenario(s.id);
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.pass, true);
    assert.equal(r.result.attempts.length, s.expect.reasons.length);
  });
}

test('scenario specifics a reader would check', () => {
  assert.equal(runScenario('primary-healthy').result.attempts.length, 1, 'no fallback attempt in the trace');
  const down = runScenario('primary-down').result;
  assert.deepEqual(down.attempts.map((a) => [a.model, a.ok, a.latencyMs]), [['model-a-large', false, 20], ['model-a-small', true, 400]]);
  assert.equal(runScenario('fallback-different-provider').result.servedBy.provider, 'provider-b');
  const r = runScenario('both-budgets-exhausted').result;
  assert.equal(r.refusal.code, 'all_budgets_exhausted');
  assert.match(r.refusal.message, /model-a-large.*model-a-small/);
  assert.equal(runScenario('one-model-chain').result.refusal.fallbackConfigured, false);
  assert.equal(runScenario('slow-primary-timeout').result.attempts[0].status, 504);
});

test('a scenario starts clean every time and does not leak state between runs', () => {
  assert.deepEqual(runScenario('primary-out-of-budget').result.ledgers.map((l) => l.spent), [900, 128]);
  assert.deepEqual(runScenario('primary-out-of-budget').result.ledgers.map((l) => l.spent), [900, 128]);
});

test('the expectation checker catches a wrong expectation and an unnamed refusal', () => {
  const r = runScenario('both-budgets-exhausted').result;
  assert.notDeepEqual(checkExpectation(r, { ...scenarioById('both-budgets-exhausted').expect, refusalCode: 'chain_exhausted' }), []);
  assert.notDeepEqual(checkExpectation(r, { ...scenarioById('both-budgets-exhausted').expect, spent: [0, 0] }), []);
  const blank = { ...r, refusal: { ...r.refusal, message: 'No model could answer.' } };
  assert.match(checkExpectation(blank, scenarioById('both-budgets-exhausted').expect).join(), /does not name every model/);
  assert.equal(runScenario('nope'), null);
  assert.equal(scenarioById('__proto__'), null);
  assert.equal(scenarioById({}), null);
});
