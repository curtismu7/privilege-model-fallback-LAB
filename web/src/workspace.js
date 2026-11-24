// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "pmf.workspace";
let memo = null;
// The same pattern the server accepts (server/src/workspaces.js): an id the server would refuse as a 400 is never generated or reused.
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

// n random bytes. Without window.crypto the fallback fills the array IN PLACE (a typed array's map() returns a new array and leaves the original all zeros).
export function randomBytes(n, c = typeof window !== "undefined" ? window.crypto : undefined) {
  const bytes = new Uint8Array(n);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && WORKSPACE_ID.test(saved)) return (memo = saved); } catch { /* blocked */ }
  memo = `w-${[...randomBytes(8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// The server answers X-Workspace-Fresh: 1 when it had to CREATE this tab's workspace and 0 when it found it. A tab remembers (sessionStorage) that it already
// used its id: a 1 after that means the server forgot the workspace (a restart, or more than 20 workspaces), so the page is looking at the defaults, and the
// app is told through the "pmf:workspace-forgotten" event.
export const FORGOTTEN_EVENT = "pmf:workspace-forgotten";
const SEEN = "pmf.workspace.seen";
const wasSeen = (id) => { try { return window.sessionStorage.getItem(SEEN) === id; } catch { return memoSeen === id; } };
let memoSeen = null;
const markSeen = (id) => { memoSeen = id; try { window.sessionStorage.setItem(SEEN, id); } catch { /* blocked */ } };
export function noteFreshness(fresh) {
  if (fresh !== "0" && fresh !== "1") return; // a route that does not touch the workspace says nothing
  const id = workspaceId();
  if (fresh === "1" && wasSeen(id)) window.dispatchEvent(new CustomEvent(FORGOTTEN_EVENT));
  markSeen(id);
}

export const workspaceFetch = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  try { noteFreshness(r.headers?.get?.("x-workspace-fresh")); } catch { /* never let the note break a call */ }
  return r;
};

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; memoSeen = null; try { window.sessionStorage.removeItem(KEY); window.sessionStorage.removeItem(SEEN); } catch { /* blocked */ } }
