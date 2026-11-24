import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLab } from './helpers.js';
import { assertBindAllowed, bindHost, isLoopbackHost, portProblem, resolvePort, allowedExtraHosts, hostOf } from '../src/safety.js';

// fetch cannot set Host, so these use node:http against the loopback server.
function raw(base, { method = 'GET', path = '/api/info', headers = {}, body }) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const q = http.request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    q.on('error', reject); q.end(body);
  });
}

test('Host check: a loopback Host works; any other Host is 421', async () => {
  const lab = await startLab();
  try {
    assert.equal((await raw(lab.base, { headers: { host: 'localhost' } })).status, 200);
    assert.equal((await raw(lab.base, { headers: { host: '127.0.0.1:7836' } })).status, 200);
    assert.equal((await raw(lab.base, { headers: { host: '[::1]:7836' } })).status, 200);
    for (const h of ['evil.example', 'evil.invalid:7836', 'localhost.evil.example', '127.0.0.1.evil.example', '[::1]evil', '0.0.0.0']) {
      const r = await raw(lab.base, { headers: { host: h } });
      assert.equal(r.status, 421, h);
      assert.equal(JSON.parse(r.text).error, 'bad_host');
    }
  } finally { await lab.close(); }
});

test('LAB_ALLOWED_HOSTS adds named hosts; a bad value is refused', () => {
  assert.deepEqual([...allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'Lab.Example, other.example' })], ['lab.example', 'other.example']);
  assert.throws(() => allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'bad host!' }), /not a host name/);
  assert.equal(hostOf('a b'), null);
});

test('same-origin writes: a cross-origin Origin or cross-site fetch metadata is 403; same origin and no Origin pass', async () => {
  const lab = await startLab();
  try {
    const body = JSON.stringify({ source: 'mock' });
    const post = (headers) => raw(lab.base, { method: 'POST', path: '/api/mode', body, headers: { host: new URL(lab.base).host, 'content-type': 'application/json', 'content-length': String(body.length), ...headers } });
    assert.equal((await post({ origin: lab.base })).status, 200);
    assert.equal((await post({ origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ origin: 'null' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'same-site' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'same-origin', origin: lab.base })).status, 200);
    assert.equal((await post({})).status, 200);
  } finally { await lab.close(); }
});

test('bind is loopback only unless PMF_BIND is set on purpose', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { PMF_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.equal(isLoopbackHost('127.0.0.1') && isLoopbackHost('::1') && isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('128.0.0.1') || isLoopbackHost('127.0.0.1.evil.example'), false);
});

test('port: default 7836 (PROVISIONAL), packed range only, reserved ports refused', () => {
  assert.equal(resolvePort({}), 7836);
  assert.equal(resolvePort({ PORT: '7900' }), 7900);
  for (const p of ['8080', '4400', '5173', '80', '8000', 'abc', '7836.5']) assert.throws(() => resolvePort({ PORT: p }), undefined, p);
  assert.equal(portProblem(7836), null);
});
