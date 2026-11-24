// Preflight: the same checks GET /api/health reports from (one per scenario, the kit pin, netguard), the netguard self-test, plus one real run of every
// scenario through the HTTP API on a throwaway loopback port, plus whether the lab's port is free. Prints only pass/fail lines. Exit 1 on failure.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard, netguardSelfTest } = await load('server/src/netguard.js');
installNetguard();
const { runChecks } = await load('server/src/doctor.js');
let failed = 0;
const report = (level, name, detail) => { if (level === 'fail') failed++; console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`); };
for (const c of runChecks()) report(c.level, c.id, c.detail);

const st = await netguardSelfTest();
report(st.ok ? 'pass' : 'fail', 'netguard-self-test', st.ok ? `every route out was refused and recorded (${st.blocked})` : st.detail);

// The same scenarios through the HTTP layer, in this process, on an ephemeral loopback port.
try {
  const { createApp, startHttpServer } = await load('server/src/app.js');
  const { createHealth } = await load('server/src/health.js');
  const { SCENARIOS } = await load('server/src/scenarios.js');
  const { validateConfig } = await load('server/src/customer.js'); // the doctor never reads the author's own customer.config.json
  const health = createHealth({ demoId: 'doctor', demoName: 'doctor', runChecks: () => [], allPassed: () => true, intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, customer: validateConfig({}), log: () => {} }) });
  try {
    const base = url.replace(/\/$/, '');
    const post = async (p, body) => (await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body ?? {}) })).json();
    const h = await (await fetch(`${base}/api/health`)).json();
    report(h.schema === 'demo-health/1' ? 'pass' : 'fail', 'api-health', `schema ${h.schema}`);
    let bad = 0;
    for (const s of SCENARIOS) { const r = await post(`/api/scenario/${s.id}`); if (!r.pass) { bad++; report('fail', `api-scenario:${s.id}`, (r.mismatches || [r.error]).join('; ')); } }
    report(bad ? 'fail' : 'pass', 'api-scenarios', bad ? `${bad} scenario(s) differ through the API` : `${SCENARIOS.length} scenarios ran through the HTTP API and matched their expectations`);
    const reset = await post('/api/reset');
    report(reset.reset === true ? 'pass' : 'fail', 'api-reset', 'reset answered');
  } finally { health.stop(); await new Promise((res) => server.close(res)); }
} catch (e) { report('fail', 'api-cycle', `the HTTP cycle could not run: ${e.message}`); }

const port = Number(process.env.PORT) || 7836;
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port-free', `${port} is not free (${e.code})`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port-free', `${port} is free (7836 is PROVISIONAL, not claimed yet)`); resolve(); }));
});
process.exit(failed ? 1 : 0);
