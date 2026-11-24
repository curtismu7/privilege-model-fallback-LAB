import test from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helpers.js';
import { SCENARIOS } from '../src/scenarios.js';

const chain2 = [{ provider: 'provider-a', model: 'm-large', budgetTokens: 1000 }, { provider: 'provider-b', model: 'm-small', budgetTokens: 500 }];

test('GET /api/health is demo-health/1', async () => {
  const lab = await startLab();
  try {
    const r = await lab.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.schema, 'demo-health/1');
    assert.equal(r.json.state, 'ready');
    assert.equal(r.json.runtime, 'offline');
    assert.equal((await lab.send('POST', '/api/health', {})).status, 405);
  } finally { await lab.close(); }
});

test('GET /api/info: Mock, Real not available with a plain reason, banner present', async () => {
  const lab = await startLab();
  try {
    const { json } = await lab.get('/api/info');
    assert.equal(json.source, 'mock');
    assert.equal(json.realAvailable, false);
    assert.match(json.realReason, /not built yet/);
    assert.match(json.banner, /SIMULATED/);
    assert.match(json.banner, /UNVERIFIED/);
    assert.match(json.banner, /2026-11-21/);
    assert.ok(json.unverified.length >= 5);
  } finally { await lab.close(); }
});

test('POST /api/mode: mock ok, real refused 409 with a plain message, anything else 400', async () => {
  const lab = await startLab();
  try {
    assert.deepEqual((await lab.send('POST', '/api/mode', { source: 'mock' })).json, { source: 'mock' });
    const real = await lab.send('POST', '/api/mode', { source: 'real' });
    assert.equal(real.status, 409);
    assert.equal(real.json.error, 'real_unavailable');
    assert.match(real.json.message, /not built yet/);
    assert.equal((await lab.send('POST', '/api/mode', { source: 'live' })).status, 400);
    assert.equal((await lab.send('POST', '/api/mode', { source: 'mock', extra: 1 })).status, 400);
    assert.equal((await lab.send('POST', '/api/mode', {})).status, 400);
    assert.equal((await lab.get('/api/mode')).json.source, 'mock');
  } finally { await lab.close(); }
});

test('GET and PUT /api/chain: config round trip; PUT builds fresh ledgers', async () => {
  const lab = await startLab();
  try {
    const first = (await lab.get('/api/chain')).json;
    assert.equal(first.chain.length, 2);
    assert.equal(first.ledgers.length, 2);
    await lab.send('POST', '/api/run', { prompt: 'hello there' });
    assert.ok((await lab.get('/api/chain')).json.ledgers[0].spent > 0);
    const put = await lab.send('PUT', '/api/chain', { chain: chain2, timeoutMs: 2000 });
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.chain, chain2);
    assert.equal(put.json.timeoutMs, 2000);
    assert.deepEqual(put.json.ledgers.map((l) => l.spent), [0, 0]);
    assert.equal((await lab.get('/api/chain')).json.chain[1].provider, 'provider-b');
  } finally { await lab.close(); }
});

test('POST /api/run: serves, falls back with providerStates, charges the right ledger, and a refusal is a named 200', async () => {
  const lab = await startLab();
  try {
    await lab.send('PUT', '/api/chain', { chain: chain2 });
    const ok = (await lab.send('POST', '/api/run', { prompt: 'one two three' })).json;
    assert.equal(ok.ok, true);
    assert.equal(ok.servedBy.model, 'm-large');
    const fb = (await lab.send('POST', '/api/run', { prompt: 'one two three', providerStates: ['overloaded'] })).json;
    assert.equal(fb.servedBy.model, 'm-small');
    assert.equal(fb.attempts[0].status, 429);
    assert.deepEqual(fb.ledgers.map((l) => l.spent), [123, 123]);
    const refused = await lab.send('POST', '/api/run', { prompt: 'one two three', providerStates: ['down', 'down'] });
    assert.equal(refused.status, 200);
    assert.equal(refused.json.ok, false);
    assert.equal(refused.json.refusal.code, 'all_providers_failed');
    assert.match(refused.json.refusal.message, /provider-a\/m-large is down.*provider-b\/m-small is down/);
    assert.ok(refused.json.clockMs > 0);
  } finally { await lab.close(); }
});

test('GET /api/scenarios lists them; POST /api/scenario/:id runs each and matches its expectation (not touching live state)', async () => {
  const lab = await startLab();
  try {
    const list = (await lab.get('/api/scenarios')).json.scenarios;
    assert.deepEqual(list.map((s) => s.id), SCENARIOS.map((s) => s.id));
    for (const s of list) {
      const r = await lab.send('POST', `/api/scenario/${s.id}`, {});
      assert.equal(r.status, 200, s.id);
      assert.equal(r.json.pass, true, `${s.id}: ${r.json.mismatches}`);
    }
    assert.deepEqual((await lab.get('/api/chain')).json.ledgers.map((l) => l.spent), [0, 0]);
    assert.equal((await lab.send('POST', '/api/scenario/nope', {})).status, 404);
    assert.equal((await lab.send('POST', '/api/scenario/__proto__', {})).status, 404);
  } finally { await lab.close(); }
});

test('POST /api/reset restores the default chain, empty ledgers and a fresh clock', async () => {
  const lab = await startLab();
  try {
    await lab.send('PUT', '/api/chain', { chain: chain2 });
    await lab.send('POST', '/api/run', { prompt: 'hello' });
    const r = (await lab.send('POST', '/api/reset', {})).json;
    assert.equal(r.reset, true);
    assert.equal(r.clockMs, 0);
    assert.deepEqual(r.ledgers.map((l) => [l.model, l.spent]), [['model-a-large', 0], ['model-a-small', 0]]);
    assert.equal((await lab.send('POST', '/api/reset')).status, 200, 'reset with no body');
  } finally { await lab.close(); }
});

test('hostile input: prompt, chain, budgets, ids and unknown fields get a 4xx and a JSON error', async () => {
  const lab = await startLab();
  try {
    const run = (b) => lab.send('POST', '/api/run', b);
    const put = (b) => lab.send('PUT', '/api/chain', b);
    const err = (r, status, code) => { assert.equal(r.status, status, r.text.slice(0, 200)); assert.equal(r.json.error, code); assert.ok(r.json.message); };
    err(await run({ prompt: 'x'.repeat(20001) }), 400, 'prompt_too_long');
    assert.equal((await run({ prompt: 'x'.repeat(20000) })).status, 200);
    err(await run({ prompt: '' }), 400, 'empty_prompt');
    err(await run({ prompt: '   ' }), 400, 'empty_prompt');
    err(await run({}), 400, 'bad_prompt');
    err(await run({ prompt: 5 }), 400, 'bad_prompt');
    err(await run({ prompt: 'hi', providerStates: ['exploded'] }), 400, 'unknown_provider_state');
    err(await run({ prompt: 'hi', providerStates: 'down' }), 400, 'bad_provider_states');
    err(await run({ prompt: 'hi', providerStates: ['down', 'down', 'down'] }), 400, 'bad_provider_states');
    err(await run({ prompt: 'hi', apiKey: 'sk-abc' }), 400, 'unknown_field');
    err(await run('{"prompt":"hi","__proto__":{"x":1}}'), 400, 'unknown_field');

    const e = chain2[0];
    err(await put({ chain: [] }), 400, 'chain_empty');
    err(await put({}), 400, 'bad_chain');
    err(await put({ chain: 'x' }), 400, 'bad_chain');
    err(await put({ chain: Array.from({ length: 6 }, (_, i) => ({ provider: 'provider-a', model: `m${i}`, budgetTokens: 1 })) }), 400, 'chain_too_long');
    assert.equal((await put({ chain: Array.from({ length: 5 }, (_, i) => ({ provider: 'provider-a', model: `m${i}`, budgetTokens: 1 })) })).status, 200);
    err(await put({ chain: [{ ...e, provider: 'real-vendor' }] }), 400, 'unknown_provider');
    err(await put({ chain: [{ ...e, provider: { toString: 1 } }] }), 400, 'unknown_provider');
    err(await put({ chain: [{ ...e, model: '../etc/passwd' }] }), 400, 'bad_model');
    err(await put({ chain: [{ ...e, model: 'm'.repeat(65) }] }), 400, 'bad_model');
    for (const b of [-1, 1.5, '100', null, NaN, 1_000_001, Infinity]) err(await put({ chain: [{ ...e, budgetTokens: b }] }), 400, 'bad_budget');
    err(await put({ chain: [{ provider: 'provider-a', model: 'm' }] }), 400, 'bad_budget');
    assert.equal((await put({ chain: [{ ...e, budgetTokens: 0 }] })).status, 200, 'zero budget is valid (it is simply out of budget)');
    assert.equal((await put({ chain: [{ ...e, budgetTokens: 1_000_000 }] })).status, 200);
    err(await put({ chain: [e, { ...e }] }), 400, 'duplicate_model');
    err(await put({ chain: [{ ...e, apiKey: 'sk-abc' }] }), 400, 'unknown_field');
    err(await put({ chain: [{ ...e, secret: 'x' }] }), 400, 'unknown_field');
    err(await put({ chain: [e], timeoutMs: 5 }), 400, 'bad_timeout');
    err(await put({ chain: [e], timeoutMs: 499 }), 400, 'bad_timeout');
    assert.equal((await put({ chain: [e], timeoutMs: 500 })).status, 200, '500 ms is the shortest accepted timeout');
    err(await put({ chain: [e], timeoutMs: 'fast' }), 400, 'bad_timeout');
    err(await put({ chain: [e], timeoutMs: 10 ** 9 }), 400, 'bad_timeout');
    err(await put({ chain: [null] }), 400, 'bad_body');
    err(await put({ chain: [[]] }), 400, 'bad_body');
    err(await put({ chain: [e], extra: 1 }), 400, 'unknown_field');
    err(await put([]), 400, 'bad_body');
  } finally { await lab.close(); }
});

test('hostile input: bad JSON, huge body, unknown route and method answer JSON, never a stack or HTML', async () => {
  const lab = await startLab();
  try {
    const bad = await lab.send('POST', '/api/run', '{not json');
    assert.deepEqual([bad.status, bad.json.error], [400, 'bad_json']);
    const big = await lab.send('POST', '/api/run', JSON.stringify({ prompt: 'x'.repeat(300_000) }));
    assert.deepEqual([big.status, big.json.error], [413, 'too_large']);
    const unknown = await lab.get('/api/nope');
    assert.deepEqual([unknown.status, unknown.json.error], [404, 'not_found']);
    const method = await lab.send('DELETE', '/api/chain');
    assert.equal(method.status, 405);
    assert.match(method.headers.get('allow'), /GET/);
    assert.equal((await lab.get('/api/run')).status, 405);
    assert.equal((await lab.get('/')).status, 404);
    assert.doesNotMatch(bad.text + big.text + unknown.text, /at .*\.js:\d+|<html/i);
    assert.equal((await lab.send('POST', '/api/run', { prompt: 'hi' }, { 'content-type': 'text/plain' })).status, 400, 'a non-JSON content type is not parsed, so the prompt is missing');
  } finally { await lab.close(); }
});

test('error messages never echo the caller\'s text', async () => {
  const lab = await startLab();
  try {
    const marker = 'zz-secret-marker-9981';
    const r = await lab.send('PUT', '/api/chain', { chain: [{ provider: marker, model: marker, budgetTokens: 1 }] });
    assert.doesNotMatch(r.text, /zz-secret-marker/);
    const r2 = await lab.send('POST', '/api/run', { prompt: marker, providerStates: [marker] });
    assert.doesNotMatch(r2.text, /zz-secret-marker/);
    const r3 = await lab.send('POST', '/api/mode', { source: marker });
    assert.doesNotMatch(r3.text, /zz-secret-marker/);
  } finally { await lab.close(); }
});
