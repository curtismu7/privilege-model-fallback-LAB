import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNER, UNVERIFIED } from '../src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    if (['node_modules', '.git'].includes(n)) continue;
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})(ROOT);
const ATTRIBUTION = new RegExp(['Co-Authored-', 'By|Generated', ' with|claude\\.com/claude', '-code'].join(''), 'i'); // built from parts so this file does not match itself
const text = (p) => fs.readFileSync(p, 'utf8');
// The shared check script names the patterns it searches for, so it is the one file the scan skips (as the script does for itself).
const mine = files.filter((p) => !p.endsWith('package-lock.json') && !p.endsWith('.sha256') && !p.endsWith('check-no-ai-attribution.sh'));

// Files copied byte for byte from the family's shared components (each pinned by its own test) or from a shared tool: their text is not this lab's.
const VENDORED = [/web\/src\/(diagram-kit|top-menu|floating-dialog|gateway-trace|run-observability|talk-track)\//, /web\/src\/components\/(JsonPane|jsonpane)/, /web\/src\/standalone-ui\.css$/,
  /server\/src\/(gatewayTrace|runObservability|diagramStudioValidate|health)\.js$/, /scripts\/(run-observability-checkPin|check-ui-standard)\./, /docs\/content-pack\.schema\.json$/];
const OWN_REPO = /^github\.com\/curtismu7\/privilege-model-fallback-LAB(\/|$)/i;

test('every host named in this lab\'s own text is loopback, .example or .invalid, or this lab\'s own repo (the apex example.com is not allowed)', () => {
  const bad = [];
  // CI workflow files name the CI tool's download host; they are not shipped lab text.
  for (const p of mine.filter((f) => !f.includes(`${path.sep}.github${path.sep}`) && !VENDORED.some((re) => re.test(f.split(path.sep).join('/'))))) {
    for (const m of text(p).matchAll(/\b(?:https?|wss?):\/\/([^\s"'`<>\\)#?]+)/gi)) {
      const h = m[1].replace(/:\d+(?=\/|$)/, '').toLowerCase();
      const host = h.split('/')[0];
      if (!(/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(host) || /(^|\.)(example|invalid)$/.test(host) || host === '${host}' || host.includes('${') || OWN_REPO.test(h))) bad.push(`${path.relative(ROOT, p)}: ${h}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no AI attribution and no key-looking secret in any tracked text', () => {
  for (const p of mine) {
    const t = text(p);
    assert.doesNotMatch(t, ATTRIBUTION, p);
    assert.doesNotMatch(t, /\bsk-(?!MOCK-)[A-Za-z0-9_-]{8,}/, p);
  }
});

test('the banner says what is simulated and labels the rest UNVERIFIED; the unverified list is explicit', () => {
  assert.match(BANNER, /^SIMULATED\./);
  assert.match(BANNER, /2026-11-21 release notes/);
  assert.match(BANNER, /UNVERIFIED/);
  assert.doesNotMatch(BANNER, /rate.?limit/i, 'no claim about a gateway\'s own rate-limit refusals');
  assert.ok(UNVERIFIED.some((u) => /overloaded/.test(u)) && UNVERIFIED.some((u) => /retry/.test(u)) && UNVERIFIED.some((u) => /mid-stream/.test(u)) && UNVERIFIED.some((u) => /guard/.test(u)));
});

test('node:test is run with a glob, never a directory', () => {
  const pkg = JSON.parse(text(path.join(ROOT, 'server/package.json')));
  assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
  assert.equal(JSON.parse(text(path.join(ROOT, 'package.json'))).engines.node, '>=26');
});
