import { afterEach, describe, expect, it } from "vitest";
import { validateConfig } from "../../../server/src/customer.js";
import { FORGOTTEN_EVENT, forgetWorkspace, noteFreshness, wasSeen, workspaceFetch, workspaceId } from "../workspace.js";
import { screen, text, useLabHarness, waitFor } from "./util.jsx";

const h = useLabHarness();
const scenarioPosts = () => h.lab.calls.filter((c) => c.path.startsWith("/api/scenario/") && c.method === "POST").length;
// The tab's own follow-up reads are done, then 20 other workspaces push this tab's (the least recently used) out.
async function evictTab() {
  await new Promise((r) => setTimeout(r, 600));
  for (let i = 0; i < 20; i += 1) await fetch(`${h.lab.base}/api/chain`, { headers: { "x-workspace": `evict-${i}` } });
}

describe("customer.config: the tagline is shown and a bad field is not silent", () => {
  it("the tagline is on every page and the warnings are listed on the Limits page", async () => {
    const customer = validateConfig({ tagline: "Fallback, in plain words", vertical: "mining", cast: { app: "see https://evil.example" } });
    const user = await h.mount({ page: "limits", customer });
    expect(text("tagline")).toBe("Fallback, in plain words");
    const items = [...screen.getByTestId("limits-config-warnings-list").querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(customer.warnings);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.join()).toMatch(/vertical/); expect(items.join()).toMatch(/cast\.app/);
    await user.click(screen.getByRole("link", { name: "Diagram" }));
    expect(text("tagline")).toBe("Fallback, in plain words");
  });
  it("nothing to warn about: no warnings card, the default tagline", async () => {
    await h.mount({ page: "limits" });
    await screen.findByTestId("limits-sourced");
    expect(screen.queryByTestId("limits-config-warnings")).toBeNull();
    expect(text("tagline")).toMatch(/second model that answers when the first cannot/);
  });
});

describe("the forgotten-workspace path", () => {
  it("(2) clears the run that was on screen, and its record, like Reset; (a) drops the scenario hash so the remount does not run it again", async () => {
    const user = await h.mount({ page: "fallback/both-budgets-exhausted" });
    await screen.findByTestId("verdict");
    expect(scenarioPosts()).toBe(1);
    await evictTab();
    await user.click(screen.getByTestId("chain-save")); // a request that is not a run raises it
    expect(await screen.findByTestId("workspace-forgotten")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("result-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("ro-empty")).toBeInTheDocument();
    expect(window.location.hash).toBe("#fallback");
    await new Promise((r) => setTimeout(r, 800));
    expect(scenarioPosts()).toBe(1); // the remount did not run S06 again
    expect(screen.queryByTestId("verdict")).toBeNull();
  });

  it("(b) the request that raised it keeps its own real result: the Run on the forgotten workspace is shown (answered from the default chain)", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("chain-remove-1")); // the tab's key: one model
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId("chain-state-0"), "down");
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(text("refusal-code")).toBe("no_fallback_configured");
    await evictTab();
    await user.click(screen.getByTestId("run")); // the server now runs the default two-model chain; the model 1 state stays "down"
    expect(await screen.findByTestId("workspace-forgotten")).toBeInTheDocument();
    await waitFor(() => expect(text("verdict-chip")).toBe("ANSWERED")); // this request's own result, not thrown away and not the older refusal
    expect(text("served-by")).toBe("provider-a/model-a-small");
    await waitFor(() => expect(screen.queryByTestId("ro-empty")).toBeNull()); // and the record of this run is read afterwards
  });

  it("(c) the tab's own Reset on a forgotten workspace does not raise the banner, and neither does anything after it", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down")); await screen.findByTestId("verdict");
    await evictTab();
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    await user.click(await screen.findByTestId("scenario-primary-healthy")); await screen.findByTestId("verdict");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });
});

describe("noteFreshness through workspaceFetch (no server)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; forgetWorkspace(); });
  const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
  const response = (status, fresh) => new Response("{}", { status, headers: fresh === undefined ? {} : { "x-workspace-fresh": fresh } });
  const listen = () => { const seen = []; const on = () => seen.push(1); window.addEventListener(FORGOTTEN_EVENT, on); return { seen, off: () => window.removeEventListener(FORGOTTEN_EVENT, on) }; };

  it("(d) two parallel first requests of a brand-new tab never raise it, whichever response arrives first; a request sent afterwards does", async () => {
    forgetWorkspace(); workspaceId();
    const a = deferred(); const b = deferred(); const queue = [a, b];
    globalThis.fetch = () => queue.shift().p;
    const { seen, off } = listen();
    try {
      const pa = workspaceFetch("/api/chain"); const pb = workspaceFetch("/api/chain"); // both sent before any response
      b.resolve(response(200, "0")); await pb; // the one that FOUND the workspace arrives first...
      a.resolve(response(200, "1")); await pa; // ...the one that CREATED it arrives second
      expect(seen).toEqual([]);
      expect(wasSeen(workspaceId())).toBe(true);
      globalThis.fetch = async () => response(200, "1"); // sent after the tab was confirmed
      await workspaceFetch("/api/chain");
      expect(seen).toHaveLength(1);
    } finally { off(); }
  });

  it("(e) a 400 that carries the header is still seen; a response without it says nothing; a 0 never raises", async () => {
    forgetWorkspace(); workspaceId();
    const { seen, off } = listen();
    try {
      globalThis.fetch = async () => response(200, "0"); await workspaceFetch("/api/chain");
      globalThis.fetch = async () => response(400, "1"); await workspaceFetch("/api/chain", { method: "PUT" });
      expect(seen).toHaveLength(1);
      globalThis.fetch = async () => response(400); await workspaceFetch("/api/chain"); // a refusal before the workspace was touched
      globalThis.fetch = async () => response(404, "0"); await workspaceFetch("/api/chain");
      expect(seen).toHaveLength(1);
      expect(noteFreshness("1", false)).toBe(false); expect(noteFreshness("1", true)).toBe(true);
    } finally { off(); }
  });
});
