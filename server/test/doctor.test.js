import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPassed, pinProblems, runChecks } from '../src/doctor.js';
import { SCENARIOS } from '../src/scenarios.js';
import { reset } from '../../scripts/reset.mjs';
import { startLab } from './helpers.js';

test('doctor: every check passes and there is one check per scenario', () => {
  const checks = runChecks({ env: {} });
  assert.equal(allPassed(checks), true, JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const s of SCENARIOS) assert.equal(checks.find((c) => c.id === `scenario:${s.id}`)?.level, 'pass', s.id);
  for (const id of ['node', 'mode', 'bind', 'port', 'allowed-hosts', 'banner', 'kit-pin', 'default-chain', 'netguard']) assert.equal(checks.find((c) => c.id === id)?.level, 'pass', id);
});

test('doctor fails on a bad bind, a bad port and a bad allowed host', () => {
  const f = (env) => runChecks({ env }).filter((c) => c.level === 'fail').map((c) => c.id);
  assert.deepEqual(f({ PMF_BIND: undefined, PORT: '8080' }), ['port']);
  assert.ok(f({ LAB_ALLOWED_HOSTS: 'not a host' }).includes('allowed-hosts'));
});

test('doctor catches an edited vendored kit file via the pin (and a missing pin is only info)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmf-pin-'));
  try {
    fs.mkdirSync(path.join(dir, 'k'));
    fs.writeFileSync(path.join(dir, 'k/a.js'), 'x');
    const pinFile = path.join(dir, 'pin');
    fs.writeFileSync(pinFile, `${'0'.repeat(64)}  k/a.js\n`);
    assert.deepEqual(pinProblems(dir, pinFile), ['k/a.js']);
    assert.equal(pinProblems(dir, path.join(dir, 'missing')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reset script: refuses a non-loopback host; resets a running lab', async () => {
  await assert.rejects(reset('http://evil.example:7836'), /loopback only/);
  const lab = await startLab();
  try {
    await lab.send('POST', '/api/run', { prompt: 'hello' });
    assert.equal((await reset(lab.base)).reset, true);
    assert.deepEqual((await lab.get('/api/chain')).json.ledgers.map((l) => l.spent), [0, 0]);
  } finally { await lab.close(); }
});
