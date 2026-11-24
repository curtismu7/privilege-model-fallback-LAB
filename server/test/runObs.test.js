import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunObservability, LAYERS, classify, defaultLayers } from '../src/runObservability.js';
import { buildRunRecord, decisionLine, eventsFor, mockLayers } from '../src/runObs.js';
import { SCENARIOS, runScenario } from '../src/scenarios.js';
import { estimateTokens } from '../src/fallback.js';
import { startLab } from './helpers.js';

const BASE = Date.parse('2026-11-24T10:00:00.000Z');
const FORBIDDEN_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;

const recordFor = async (id) => {
  const s = SCENARIOS.find((x) => x.id === id);
  const out = runScenario(id);
  const events = eventsFor(out.result, { needed: estimateTokens(s.prompt), baseMs: BASE });
  const run = { id: 'run-1', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + out.result.totals.latencyMs).toISOString(), events };
  return { record: await buildRunRecord(run, { clock: () => BASE }), events, out };
};

test('every scenario leaves a record that passes the shared assertRunObservability, all rows simulated, all six layers named', async () => {
  for (const s of SCENARIOS) {
    const { record } = await recordFor(s.id);
    assert.deepEqual(assertRunObservability(record), [], s.id);
    assert.equal(record.source, 'mock');
    assert.ok(record.rows.length >= 3, s.id);
    assert.deepEqual(Object.keys(record.coverage).sort(), [...LAYERS].sort(), s.id);
    for (const r of record.rows) assert.ok(r.origin === 'simulated' || r.origin === 'not-logged', `${s.id}: ${r.origin}`);
    for (const l of ['person', 'authorize', 'gateway']) assert.equal(record.coverage[l], 'not-logged', `${s.id}: ${l} has nothing and says so`);
    assert.ok(record.reasons.person && record.reasons.gateway, 'a layer with nothing says why');
  }
});

test('the rows say what happened: a served run is allowed, a refusal is refused, a provider reply is information, never invented', async () => {
  const healthy = await recordFor('primary-healthy');
  assert.deepEqual(healthy.record.summary, { allowed: 2, refused: 0, blocked: 0, info: 2, unverified: 0 }, 'budget check + answer allowed; the app call and the provider reply are information');
  assert.equal(healthy.record.rows.filter((r) => r.layer === 'resource').length, 1, 'one provider call, one reply');
  const skipped = await recordFor('primary-out-of-budget');
  const refusedRow = skipped.record.rows.find((r) => r.outcome === 'refused');
  assert.match(refusedRow.message, /skipped without a provider call/);
  assert.equal(skipped.record.rows.filter((r) => r.layer === 'resource').length, 1, 'the skipped model made no provider call and left no provider row');
  const budgets = await recordFor('both-budgets-exhausted');
  assert.equal(budgets.record.coverage.resource, 'not-logged', 'no provider was called, so the resource layer is empty and says so');
  assert.match(budgets.record.reasons.resource, /No model provider was called/);
  assert.ok(budgets.record.rows.some((r) => r.outcome === 'refused' && /all_budgets_exhausted/.test(r.message)));
  const down = await recordFor('both-providers-down');
  assert.equal(down.record.rows.filter((r) => r.layer === 'resource').length, 2);
  assert.equal(down.record.summary.refused, 1);
});

test('row times are the stdout line times: one stamp per event, in time order, offsets from the lab clock', async () => {
  const { record, events, out } = await recordFor('primary-down');
  const times = record.rows.filter((r) => r.at).map((r) => r.at);
  assert.deepEqual(times, [...times].sort(), 'rows are in time order');
  assert.ok(events.every((e) => record.rows.some((r) => r.at === e.at)));
  const last = events.map((e) => Date.parse(e.at)).sort((a, b) => a - b).at(-1);
  assert.equal(last - BASE, out.result.totals.latencyMs, 'the last event is at the end of the lab-clock run');
});

test('the stdout line: one per decision, loopless vocabulary, a hostile name cannot forge a second field or a second line', () => {
  const e = { at: '2026-11-24T10:00:00.000Z', step: 'budget-check', actor: 'provider-a/model-a-large', outcome: 'refused' };
  assert.equal(decisionLine(e, 'run-3'), '2026-11-24T10:00:00.000Z privilege-model-fallback-lab decision step=budget-check actor=provider-a/model-a-large result=stopped run=run-3');
  const hostile = decisionLine({ ...e, actor: 'x result=passed\nrun=evil\r\n2026 forged line', step: 'a b' }, 'run 1\n');
  assert.ok(!/[\r\n]/.test(hostile));
  assert.equal(hostile.split(' ').filter((w) => w.startsWith('result=')).length, 1);
  assert.equal((hostile.match(/ run=/g) || []).length, 1);
});

test('no stdout line uses a word a shared matcher reads as a decision, and none is classified as a product line', async () => {
  const lines = [];
  for (const s of SCENARIOS) for (const e of (await recordFor(s.id)).events) lines.push(decisionLine(e, 'run-1').replace(/^\S+ privilege-model-fallback-lab /, ''));
  assert.ok(lines.length > 20);
  for (const l of lines) assert.doesNotMatch(l, FORBIDDEN_WORDS, l);
  for (const l of lines) assert.equal(classify(`2026-11-24T10:00:00.000Z privilege-model-fallback-lab ${l}`), null, l);
});

test('the lab reads no logs: only the collector core is vendored, and the layers carry only simulated rows', () => {
  const layers = mockLayers(eventsFor(runScenario('primary-healthy').result, { needed: 128, baseMs: BASE }));
  assert.deepEqual(layers.map((l) => l.layer), [...LAYERS]);
  assert.ok(layers.every((l) => l.products.length === 0 && !l.responses), 'no product reader and no API response row');
  assert.ok(defaultLayers().length > 0);
});

test('API: /api/run-observability is null before any run; a live run and a scenario run each leave their record; the stdout lines match the rows', async () => {
  const lines = [];
  const lab = await startLab({ log: (l) => lines.push(l), now: () => BASE });
  try {
    const empty = (await lab.get('/api/run-observability')).json;
    assert.equal(empty.record, null); assert.ok(empty.streams.length >= 2);
    const run = (await lab.send('POST', '/api/run', { prompt: 'summarise the open cases', providerStates: ['down', 'healthy'] })).json;
    assert.match(run.runId, /^run-\d+$/);
    const live = (await lab.get('/api/run-observability')).json;
    assert.equal(live.run.kind, 'live'); assert.equal(live.record.runId, run.runId);
    assert.deepEqual(assertRunObservability(live.record), []);
    assert.equal(lines.length, live.record.rows.filter((r) => r.origin === 'simulated').length, 'one stdout line per simulated row');
    for (const r of live.record.rows.filter((x) => x.origin === 'simulated')) assert.ok(lines.some((l) => l.startsWith(r.at)), r.message);
    const sc = (await lab.send('POST', '/api/scenario/primary-healthy', {})).json;
    const after = (await lab.get('/api/run-observability')).json;
    assert.equal(after.run.kind, 'scenario'); assert.equal(after.run.scenarioId, 'primary-healthy'); assert.equal(after.record.runId, sc.runId);
    assert.equal((await lab.get('/api/chain')).json.ledgers.map((l) => l.spent).join(), '0,124', 'the scenario did not touch the live key: only the live run charged the fallback');
    assert.equal((await lab.get('/api/log')).json.runs.length, 2);
    assert.equal((await lab.send('POST', '/api/run-observability', {})).status, 405);
  } finally { await lab.close(); }
});

test('a refused prompt leaves no run behind (nothing was decided)', async () => {
  const lab = await startLab();
  try {
    assert.equal((await lab.send('POST', '/api/run', { prompt: '' })).status, 400);
    assert.equal((await lab.get('/api/run-observability')).json.record, null);
    assert.equal((await lab.get('/api/log')).json.runs.length, 0);
  } finally { await lab.close(); }
});

test('the run log is bounded', async () => {
  const lab = await startLab();
  try {
    for (let i = 0; i < 25; i++) await lab.send('POST', '/api/scenario/primary-healthy', {});
    assert.equal((await lab.get('/api/log')).json.runs.length, 20);
    assert.equal((await lab.get('/api/log')).json.runs[0].runId, 'run-25');
  } finally { await lab.close(); }
});
