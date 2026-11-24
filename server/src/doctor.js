// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a setting's value.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }. One check per scenario: it must give the result its expectation says.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allowedExtraHosts, assertBindAllowed, bindHost, portProblem, DEFAULT_PORT } from './safety.js';
import { installNetguard } from './netguard.js';
import { SCENARIOS, runScenario } from './scenarios.js';
import { BANNER, RELEASE_NOTES_DATE } from './data.js';
import { DEFAULT_CHAIN } from './scenarios.js';
import { validateConfig } from './validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PIN = path.join(ROOT, 'server/test/model-gateway-sim.sha256');

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');

// The vendored model-gateway-sim files must match the pin byte for byte. Missing pin file (a slim image) is info, a mismatch is a failure.
export function pinProblems(root = ROOT, pinFile = PIN) {
  let text;
  try { text = fs.readFileSync(pinFile, 'utf8'); } catch { return null; }
  const bad = [];
  for (const line of text.split('\n').filter(Boolean)) {
    const [hash, rel] = line.split(/\s+/);
    let got = '';
    try { got = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex'); } catch { /* missing file */ }
    if (got !== hash) bad.push(rel);
  }
  return bad;
}

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);
  add('mode', 'pass', 'Mock is the only source; Real is not built yet (the toggle answers 409 with a reason)');

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.PMF_BIND ? ' (PMF_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port', problem ? 'fail' : 'pass', problem || `${port} is in the packed range and not reserved (7836 is PROVISIONAL, not claimed on the board yet)`);

  try { const n = allowedExtraHosts(env).size; add('allowed-hosts', 'pass', `LAB_ALLOWED_HOSTS is valid (${n} extra host name${n === 1 ? '' : 's'}; loopback always works)`); }
  catch (e) { add('allowed-hosts', 'fail', e.message); }

  const bannerOk = BANNER.includes('SIMULATED') && BANNER.includes(RELEASE_NOTES_DATE) && BANNER.includes('UNVERIFIED');
  add('banner', bannerOk ? 'pass' : 'fail', bannerOk ? 'the banner says what is simulated and that behaviour beyond the release notes is UNVERIFIED' : 'the banner is missing SIMULATED, the release-notes date or UNVERIFIED');

  const pin = pinProblems();
  if (pin === null) add('kit-pin', 'info', 'no pin file here (a slim image); the pin test checks it in the repo');
  else add('kit-pin', pin.length ? 'fail' : 'pass', pin.length ? `vendored kit file(s) differ from the pin: ${pin.join(', ')}` : 'the vendored model-gateway-sim files match the pin');

  try { validateConfig({ chain: DEFAULT_CHAIN }); add('default-chain', 'pass', 'the default chain passes the same validation as PUT /api/chain'); }
  catch { add('default-chain', 'fail', 'the default chain does not pass validation'); }

  // Every scenario gives the result its hand-written expectation says, and the netguard sees no outbound attempt while they run.
  const guard = installNetguard();
  const before = guard.attempts.length;
  for (const s of SCENARIOS) {
    let r;
    try { r = runScenario(s.id); } catch (e) { add(`scenario:${s.id}`, 'fail', `threw: ${e.message}`); continue; }
    add(`scenario:${s.id}`, r.pass ? 'pass' : 'fail', r.pass ? s.title : `${s.title}: ${r.mismatches.join('; ')}`);
  }
  const attempts = guard.attempts.length - before;
  add('netguard', attempts === 0 ? 'pass' : 'fail', attempts === 0 ? 'zero outbound attempts while every scenario ran' : `${attempts} outbound attempt(s) were refused`);
  return checks;
}
