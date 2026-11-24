// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "pmf.workspace";
let memo = null;
// The same pattern the server accepts (server/src/workspaces.js): an id the server would refuse as a 400 is never generated or reused.
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && WORKSPACE_ID.test(saved)) return (memo = saved); } catch { /* blocked */ }
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  memo = `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

export const workspaceFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; try { window.sessionStorage.removeItem(KEY); } catch { /* blocked */ } }
