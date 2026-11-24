import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';
import { SCENARIOS, runScenario } from '../src/scenarios.js';
import { startLab } from './helpers.js';
import { createApp, startHttpServer } from '../src/app.js';
import { validateConfig } from '../src/customer.js';

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

// An opted-in bind (PMF_BIND=<a LAN address>) must start: listen() resolves even a literal IP through dns.lookup, which is not a name-server query.
test('a literal IP needs no DNS: its lookup is allowed and not recorded, a NAME is still refused, and connecting to the literal is still refused', async () => {
  const g = installNetguard();
  try {
    for (const ip of ['192.0.2.7', '10.1.2.3', '::', '0.0.0.0', '2001:db8::1']) {
      const got = await new Promise((resolve, reject) => dns.lookup(ip, (e, address) => (e ? reject(e) : resolve(address))));
      assert.equal(got, ip);
      assert.equal((await dns.promises.lookup(ip)).address, ip);
    }
    assert.deepEqual(g.attempts, [], 'a literal IP lookup is not an outbound attempt');
    await assert.rejects(dns.promises.lookup('lan-host.example.invalid'), /network blocked/);
    await assert.rejects(new Promise((_, rej) => dns.lookup('lan-host.example.invalid', (e) => rej(e))), /network blocked/);
    assert.deepEqual(g.attempts, ['dns:lan-host.example.invalid', 'dns:lan-host.example.invalid']);
    g.attempts.length = 0;
    await assert.rejects(new Promise((_, rej) => { const s = net.connect({ host: '192.0.2.7', port: 80 }); s.on('error', rej); }), /network blocked: 192\.0\.2\.7/);
    assert.deepEqual(g.attempts, ['socket:192.0.2.7']);
    g.attempts.length = 0;
    const st = await netguardSelfTest();
    assert.equal(st.ok, true, st.detail); assert.equal(st.blocked, 6, 'the self-test still proves every route out is refused');
  } finally { g.restore(); }
});

test('with the guard on, a server can listen on a non-loopback literal address of this machine (PMF_BIND opt-in), with zero outbound attempts', async (t) => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
  if (!lan) { t.skip('this machine has no non-loopback IPv4 interface'); return; }
  const g = installNetguard();
  try {
    const { server, url } = await startHttpServer({ port: 0, host: lan.address, app: createApp({ log: () => {}, customer: validateConfig({}) }) });
    try {
      assert.equal(new URL(url).hostname, lan.address);
      assert.deepEqual(g.attempts, []);
    } finally { await new Promise((r) => server.close(r)); }
  } finally { g.restore(); }
});
