import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The vendored model-gateway-sim kit must equal the canonical copy byte for byte: a hand edit fails here.
// The pin file is a copy of shared/model-gateway-sim/model-gateway-sim.sha256 (paths are relative to this repo's root).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pin = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-gateway-sim.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/\s+/));
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

test('the pin lists exactly the three kit files', () => {
  assert.deepEqual(pin.map(([, rel]) => rel).sort(), ['server/src/model-gateway-sim/labClock.js', 'server/src/model-gateway-sim/llmKey.js', 'server/src/model-gateway-sim/providerStub.js']);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'server/src/model-gateway-sim')).sort(), ['labClock.js', 'llmKey.js', 'providerStub.js'], 'no extra file in the vendored folder');
});

for (const [hash, rel] of pin) {
  test(`vendored ${rel} matches the pin`, () => { assert.equal(sha(rel), hash, `${rel} was edited: change the kit first, then re-vendor`); });
}
