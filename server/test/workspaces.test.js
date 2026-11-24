import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaces, validWorkspace, MAX_WORKSPACES } from '../src/workspaces.js';
import { startLab } from './helpers.js';

const chain1 = [{ provider: 'provider-a', model: 'only-one', budgetTokens: 300 }];

test('workspaces: default exists, ids are validated, the cap spares the default, reset gives the slot back', () => {
  const ws = createWorkspaces({ build: (id) => ({ id }), max: 2 });
  assert.equal(ws.get().id, 'default');
  ws.get('a'); ws.get('b');
  ws.get('a'); // a is now the most recently used
  assert.equal(ws.get('c').id, 'c');
  assert.deepEqual(ws.ids().sort(), ['a', 'c', 'default'], 'the least recently used (b) was forgotten, never a refusal, and the default stays');
  ws.reset('a');
  assert.deepEqual(ws.ids().sort(), ['c', 'default']);
  for (const bad of ['', 'A', '-x', 'a'.repeat(33), 'a b', '__proto__', 5, null]) assert.equal(validWorkspace(bad), false, String(bad));
  assert.throws(() => ws.get('Bad Id'), (e) => e.code === 'bad_workspace');
  assert.equal(MAX_WORKSPACES, 20);
});

test('the key, the clock and the last run are per workspace; Reset clears one only', async () => {
  const lab = await startLab();
  try {
    const w = (id) => ({ 'x-workspace': id });
    assert.equal((await lab.send('PUT', '/api/chain', { chain: chain1 }, w('alpha'))).status, 200);
    const a = (await lab.get('/api/chain', w('alpha'))).json;
    const d = (await lab.get('/api/chain')).json;
    assert.equal(a.chain.length, 1); assert.equal(d.chain.length, 2, 'the default workspace keeps its own key');
    await lab.send('POST', '/api/run', { prompt: 'hello there' }, w('alpha'));
    assert.equal((await lab.get('/api/chain', w('alpha'))).json.clockMs, 400);
    assert.equal((await lab.get('/api/chain')).json.clockMs, 0, 'the default clock did not move');
    assert.equal((await lab.get('/api/run-observability')).json.record, null, 'the default workspace has no run');
    assert.ok((await lab.get('/api/run-observability', w('alpha'))).json.record);
    assert.equal((await lab.get('/api/log', w('alpha'))).json.runs.length, 1);
    await lab.send('POST', '/api/run', { prompt: 'hello there' });
    const r = await lab.send('POST', '/api/reset', {}, w('alpha'));
    assert.equal(r.json.workspace, 'alpha'); assert.equal(r.json.chain.length, 2, 'alpha is back to the default chain');
    assert.equal((await lab.get('/api/run-observability', w('alpha'))).json.record, null);
    assert.equal((await lab.get('/api/log')).json.runs.length, 1, 'the default workspace was not reset');
    assert.equal((await lab.get('/api/info', w('alpha'))).json.workspace, 'alpha');
  } finally { await lab.close(); }
});

test('a malformed X-Workspace is a 400 with a message, never silently the default; past the cap the oldest workspace is forgotten, not a lock-out', async () => {
  const lab = await startLab();
  try {
    for (const bad of ['Bad Id', '../x', 'A', 'a'.repeat(40)]) {
      const r = await lab.get('/api/chain', { 'x-workspace': bad });
      assert.deepEqual([r.status, r.json.error], [400, 'bad_workspace'], bad);
    }
    await lab.send('PUT', '/api/chain', { chain: chain1 }, { 'x-workspace': 'w0' }); // w0 is the oldest
    for (let i = 1; i < MAX_WORKSPACES; i++) assert.equal((await lab.get('/api/chain', { 'x-workspace': `w${i}` })).status, 200);
    assert.equal((await lab.get('/api/chain', { 'x-workspace': 'one-too-many' })).status, 200, 'a new tab past the cap is admitted');
    assert.equal((await lab.get('/api/chain', { 'x-workspace': 'w0' })).json.chain.length, 2, 'the oldest workspace (w0) was forgotten: it starts fresh');
    assert.equal((await lab.get('/api/chain')).status, 200, 'the default workspace is always admitted');
    assert.equal((await lab.send('POST', '/api/reset', {}, { 'x-workspace': 'w5' })).status, 200);
  } finally { await lab.close(); }
});

test('X-Workspace-Fresh: 1 only when the request had to create the workspace; a reset is deliberate (0); a forgotten workspace comes back as 1', async () => {
  const lab = await startLab();
  try {
    const w = (id) => ({ 'x-workspace': id });
    assert.equal((await lab.get('/api/chain', w('tab-a'))).headers.get('x-workspace-fresh'), '1', 'the first request of a tab creates it');
    assert.equal((await lab.get('/api/chain', w('tab-a'))).headers.get('x-workspace-fresh'), '0');
    assert.equal((await lab.send('POST', '/api/run', { prompt: 'hello there' }, w('tab-a'))).headers.get('x-workspace-fresh'), '0');
    assert.equal((await lab.send('POST', '/api/reset', {}, w('tab-a'))).headers.get('x-workspace-fresh'), '0');
    assert.equal((await lab.get('/api/chain', w('tab-a'))).headers.get('x-workspace-fresh'), '0', 'after a reset the workspace exists');
    assert.equal((await lab.get('/api/info', w('tab-a'))).headers.get('x-workspace-fresh'), null, 'info does not touch a workspace');
    // more than 20 other workspaces: the least recently used (tab-a) is forgotten, and its next request says so
    for (let i = 0; i < MAX_WORKSPACES; i++) await lab.get('/api/chain', w(`other-${i}`));
    await lab.send('PUT', '/api/chain', { chain: chain1 }, w('other-3'));
    const back = await lab.get('/api/chain', w('tab-a'));
    assert.equal(back.headers.get('x-workspace-fresh'), '1');
    assert.equal(back.json.chain.length, 2, 'it is the default key again');
    assert.equal((await lab.get('/api/chain', w('tab-a'))).headers.get('x-workspace-fresh'), '0');
    // the default workspace is never evicted and never reported fresh after its first use
    assert.equal((await lab.get('/api/chain')).headers.get('x-workspace-fresh'), '1');
    assert.equal((await lab.get('/api/chain')).headers.get('x-workspace-fresh'), '0');
  } finally { await lab.close(); }
});

test('the unit: acquire says whether it created, and least recently USED order is kept (a hit moves to the end)', () => {
  const ws = createWorkspaces({ build: (id) => ({ id }), max: 2 });
  assert.equal(ws.acquire('a').created, true); assert.equal(ws.acquire('b').created, true);
  assert.equal(ws.acquire('a').created, false); // a is now the most recent
  assert.equal(ws.acquire('c').created, true);   // b (least recently used) goes
  assert.deepEqual(ws.ids(), ['a', 'c']);
  assert.equal(ws.acquire('b').created, true, 'b was forgotten');
});

test('a wrong method with a bad body is a 405, not a 400 about the body (the 405 check runs before the body is parsed)', async () => {
  const lab = await startLab();
  try {
    const r = await lab.send('POST', '/api/info', '{not json');
    assert.deepEqual([r.status, r.json.error], [405, 'method_not_allowed']);
    assert.equal((await lab.send('POST', '/api/run', '{not json')).json.error, 'bad_json', 'an accepted method still gets the body error');
  } finally { await lab.close(); }
});
