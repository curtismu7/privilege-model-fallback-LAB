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

// The server answers X-Workspace-Fresh: 1 when it had to CREATE this tab's workspace and 0 when it found it (only on routes that touch the workspace, on any
// status). A tab remembers (sessionStorage) that a response already confirmed its id. A 1 is "the server forgot this workspace" (a restart, or more than 20
// workspaces) ONLY for a request that was SENT after such a confirmation: that is decided at send time, never by which response happens to arrive first
// (two parallel first requests of a brand-new tab: one creates, one finds; they may arrive in either order and neither is a forgotten workspace).
// The app is told through the "pmf:workspace-forgotten" event.
export const FORGOTTEN_EVENT = "pmf:workspace-forgotten";
const SEEN = "pmf.workspace.seen";
let memoSeen = null;
export const wasSeen = (id) => { try { return window.sessionStorage.getItem(SEEN) === id; } catch { return memoSeen === id; } };
const markSeen = (id) => { memoSeen = id; try { window.sessionStorage.setItem(SEEN, id); } catch { /* blocked */ } };
// fresh: the header's value; knewAtSend: whether a response had already confirmed the id when the request was sent.
export function noteFreshness(fresh, knewAtSend = wasSeen(workspaceId())) {
  if (fresh !== "0" && fresh !== "1") return false; // a route that does not touch the workspace says nothing
  markSeen(workspaceId());
  if (fresh === "1" && knewAtSend) { window.dispatchEvent(new CustomEvent(FORGOTTEN_EVENT)); return true; }
  return false;
}

export const workspaceFetch = async (url, opts = {}) => {
  const knewAtSend = wasSeen(workspaceId());
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  try { noteFreshness(r.headers?.get?.("x-workspace-fresh"), knewAtSend); } catch { /* never let the note break a call */ }
  return r;
};

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; memoSeen = null; try { window.sessionStorage.removeItem(KEY); window.sessionStorage.removeItem(SEEN); } catch { /* blocked */ } }
