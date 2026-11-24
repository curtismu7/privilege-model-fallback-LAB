#!/usr/bin/env node
// Reset ONE workspace of a running lab: its key goes back to the default chain with empty budgets, its lab clock to zero, its last run and run log are cleared.
//   node scripts/reset.mjs [base-url] [workspace]      (default http://localhost:${PORT:-7836}, workspace PMF_WORKSPACE or "default")
//   PMF_WORKSPACE=w-0123abcd node scripts/reset.mjs    (a browser tab's workspace id is in its sessionStorage, key pmf.workspace)
// Other workspaces are untouched. Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server
// requires and the workspace in X-Workspace.
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/safety.js';
import { DEFAULT_WORKSPACE, validWorkspace } from '../server/src/workspaces.js';

export async function reset(base = `http://localhost:${process.env.PORT || 7836}`, workspace = process.env.PMF_WORKSPACE || DEFAULT_WORKSPACE) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  if (!validWorkspace(workspace)) throw new Error('workspace must be 1 to 32 lowercase letters, digits and dashes, starting with a letter or digit');
  const r = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin, 'x-workspace': workspace }, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv[2] || undefined, process.argv[3] || undefined).then((j) => console.log(`reset: ${j.reset} (workspace ${j.workspace})`), (e) => { console.error(e.message); process.exit(1); });
}
