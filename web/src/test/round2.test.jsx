import { describe, expect, it } from "vitest";
import { randomBytes } from "../workspace.js";
import { jsonResponse } from "./harness.js";
import { screen, text, useLabHarness, waitFor } from "./util.jsx";

const h = useLabHarness();
const realOn = { "/api/info": async (_init, _u, go) => { const r = await go(); return jsonResponse(200, { ...(await r.json()), realAvailable: true }); } };

describe("pressing the already-active Mock button changes nothing", () => {
  it("no POST /api/mode, no reload, and the last run stays on the page", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("verdict");
    const posts = () => h.lab.calls.filter((c) => c.path === "/api/mode").length;
    const loads = () => h.lab.calls.filter((c) => c.path === "/api/info" || c.path === "/api/story").length;
    const [p, l] = [posts(), loads()];
    await user.click(screen.getByTestId("mode-mock"));
    await new Promise((r) => setTimeout(r, 300));
    expect([posts(), loads()]).toEqual([p, l]);
    expect(screen.getByTestId("verdict")).toBeInTheDocument();
    expect(text("served-by")).toBe("provider-a/model-a-small");
  });
});

describe("'Load this key into the form' and a scenario that starts part-spent", () => {
  it("is offered for a scenario with no pre-spend and explained (not offered) for one that has pre-spend", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("scenario-load");
    expect(screen.queryByTestId("scenario-load-note")).toBeNull();
    for (const id of ["primary-out-of-budget", "both-budgets-exhausted"]) {
      await user.click(screen.getByTestId(`scenario-${id}`));
      await waitFor(() => expect(screen.getByTestId("scenario-load-note")).toBeInTheDocument());
      expect(screen.queryByTestId("scenario-load")).toBeNull();
      expect(text("scenario-load-note")).toMatch(/budgets already spent \(model 1: 900 tokens/);
    }
    await user.click(screen.getByTestId("scenario-primary-healthy"));
    await screen.findByTestId("scenario-load");
  });
});

describe("the random workspace fallback", () => {
  it("fills the array in place when window.crypto is missing: not all zeros, right length", () => {
    for (const c of [undefined, {}, { getRandomValues: "no" }]) {
      const seen = new Set();
      for (let i = 0; i < 5; i += 1) { const b = randomBytes(8, c); expect(b).toHaveLength(8); b.forEach((x) => seen.add(x)); }
      expect(seen.size).toBeGreaterThan(8);
      expect([...randomBytes(8, c)].every((x) => x === 0)).toBe(false);
    }
    expect(randomBytes(8, { getRandomValues: (a) => { a.fill(7); return a; } })).toEqual(new Uint8Array(8).fill(7));
  });
});

describe("stale messages go away", () => {
  it("a mode error is cleared by Reset and by a vertical change", async () => {
    const user = await h.mount({ overrides: realOn });
    await user.click(screen.getByTestId("mode-real"));
    await screen.findByTestId("mode-error-banner");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("mode-error-banner")).toBeNull());
    await user.click(screen.getByTestId("mode-real"));
    await screen.findByTestId("mode-error-banner");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    await waitFor(() => expect(screen.queryByTestId("mode-error-banner")).toBeNull());
  });

  it("the Reset note is gone once a new run starts", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Reset: the key is back/));
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("verdict");
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(""));
    await user.click(screen.getByTestId("run"));
    await waitFor(() => expect(screen.getByTestId("reset-note").textContent).toBe(""));
  });
});
