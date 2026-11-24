import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';
import { SCENARIOS, runScenario } from '../src/scenarios.js';
import { startLab } from './helpers.js';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 6);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*socket-ip: blocked.*dns: blocked.*dns-resolve: blocked.*udp: blocked/);
  installNetguard().restore();
});

test('a real outbound attempt is blocked and recorded; restore puts the real functions back', async () => {
  const before = net.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(net.Socket.prototype.connect, before);
  await assert.rejects(fetch('https://outbound.example.invalid/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
  assert.deepEqual(g.attempts, ['fetch:outbound.example.invalid']);
  g.restore();
  assert.equal(net.Socket.prototype.connect, before);
});

test('ZERO outbound attempts while every scenario runs and the whole HTTP API is exercised', async () => {
  const g = installNetguard();
  const lab = await startLab();
  try {
    for (const s of SCENARIOS) runScenario(s.id);
    for (const s of SCENARIOS) assert.equal((await lab.send('POST', `/api/scenario/${s.id}`, {})).status, 200);
    await lab.get('/api/info'); await lab.get('/api/chain'); await lab.get('/api/scenarios'); await lab.get('/api/health');
    await lab.send('POST', '/api/run', { prompt: 'hello world', providerStates: ['down', 'overloaded'] });
    await lab.send('PUT', '/api/chain', { chain: [{ provider: 'provider-a', model: 'm', budgetTokens: 0 }] });
    await lab.send('POST', '/api/mode', { source: 'real' });
    await lab.send('POST', '/api/reset', {});
    assert.deepEqual(g.attempts, [], 'no DNS, socket, fetch or UDP attempt left this machine');
  } finally { await lab.close(); g.restore(); }
});
