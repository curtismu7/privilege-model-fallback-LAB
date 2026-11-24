import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

// A running app on an ephemeral loopback port with a quiet health timer. Returns { base, get, send, close }.
export async function startLab() {
  const health = createHealth({ demoId: 'test', demoName: 'test', runChecks: () => [], allPassed: () => true, intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health }) });
  const base = url.replace(/\/$/, '');
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: base } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    base,
    get: (p, h) => call('GET', p, undefined, h),
    send: call,
    close: async () => { health.stop(); await new Promise((r) => server.close(r)); },
  };
}
