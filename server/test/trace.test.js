import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrace } from '../src/gatewayTrace.js';
import { exchangesFor } from '../src/runTrace.js';
import { SCENARIOS, runScenario } from '../src/scenarios.js';
import { estimateTokens } from '../src/fallback.js';
import { startLab } from './helpers.js';

const exchangesOf = (s) => exchangesFor(runScenario(s.id).result, { prompt: s.prompt, needed: estimateTokens(s.prompt) });

test('every scenario produces traces that pass assertTrace, all mock, every decision checked', () => {
  for (const s of SCENARIOS) {
    const ex = exchangesOf(s);
    assert.ok(ex.length >= 1, s.id);
    ex.forEach((e, i) => { assert.equal(e.step, i + 1); assert.deepEqual(assertTrace(e.trace), [], `${s.id} step ${e.step}`); assert.equal(e.trace.source, 'mock'); });
    for (const e of ex) for (const d of e.trace.decisions) assert.equal(d.basis, 'checked', `${s.id}: ${d.id}`);
  }
});

test('one step for the app\'s call, then one per provider call the gateway really made; a skipped model has no provider step', () => {
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, exchangesOf(s)]));
  assert.equal(by['primary-healthy'].length, 2);
  assert.equal(by['primary-down'].length, 3);
  assert.equal(by['primary-out-of-budget'].length, 2, 'the primary was skipped before any call');
  assert.equal(by['both-budgets-exhausted'].length, 1, 'no provider was called');
  assert.match(by['both-budgets-exhausted'][0].title, /refused \(all_budgets_exhausted\)/);
  assert.equal(by['both-providers-down'].length, 3);
});

test('the summary line of a served run is never "refused at": failures that fell back are information, only the final refusal is a failure', () => {
  const down = exchangesOf(SCENARIOS.find((s) => s.id === 'primary-down'))[0].trace.decisions;
  assert.equal(down.filter((d) => d.outcome === 'fail').length, 0);
  assert.ok(down.some((d) => d.outcome === 'info' && /Could not answer/.test(d.evidence)));
  const refused = exchangesOf(SCENARIOS.find((s) => s.id === 'both-providers-down'))[0].trace.decisions;
  assert.equal(refused.filter((d) => d.outcome === 'fail').length, 1);
  const healthy = exchangesOf(SCENARIOS.find((s) => s.id === 'primary-healthy'))[0].trace.decisions;
  assert.ok(healthy.some((d) => d.outcome === 'skipped' && /Not tried/.test(d.evidence)), 'the fallback is shown as not tried');
});

test('nothing secret and nothing real in a trace: .example hosts, labelled mock credentials, no token-shaped value', () => {
  for (const s of SCENARIOS) {
    const text = JSON.stringify(exchangesOf(s));
    for (const m of text.matchAll(/https?:\/\/([^/"\\]+)/g)) assert.match(m[1], /\.example$/, m[1]);
    assert.match(text, /a lab mock value, not a credential/);
    assert.doesNotMatch(text, /eyJ[\w-]{8,}\.|sk-[A-Za-z0-9]{8,}/);
  }
});

test('the API returns the trace with the run and the scenario', async () => {
  const lab = await startLab();
  try {
    const run = (await lab.send('POST', '/api/run', { prompt: 'hello there', providerStates: ['overloaded'] })).json;
    assert.equal(run.trace.exchanges.length, 3);
    assert.equal(run.trace.exchanges[1].status, 429);
    const sc = (await lab.send('POST', '/api/scenario/slow-primary-timeout', {})).json;
    assert.equal(sc.trace.exchanges[1].status, 504);
    assert.equal(sc.result.totals.latencyMs, 3400);
  } finally { await lab.close(); }
});
