import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { allowedExtraHosts, assertBindAllowed, bindHost, resolvePort } from './safety.js';

const TAG = '[privilege-model-fallback-lab]';
installNetguard(); // Mock makes zero outbound calls.

// A bad LAB_ALLOWED_HOSTS is a start-up error with a message, not a 421 on every request.
try { allowedExtraHosts(process.env); } catch (e) { console.error(`${TAG} refusing to start: ${e.message}`); process.exit(1); }

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`${TAG} refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`${TAG} lab at ${url} (Mock only; bound to ${host}; no outbound calls)`);
console.log(`${TAG} health: ${url}api/health`);
