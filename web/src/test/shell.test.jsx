import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { BANNER } from "../../../server/src/data.js";
import { jsonResponse } from "./harness.js";
import { nav, screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();
const PAGES = ["Fallback", "Diagram", "Stories and talk track", "Limits (UNVERIFIED)"];

describe("shell: banner, mode toggle, presenter, talk track, reset", () => {
  it("shows the simulation banner FIRST in the page on every page, with the server's own words", async () => {
    const user = await h.mount();
    for (const p of PAGES) {
      await nav(user, p);
      expect(document.querySelector("main").firstElementChild, p).toBe(screen.getByTestId("banner"));
      expect(text("banner"), p).toBe(BANNER);
      expect(text("banner")).toMatch(/UNVERIFIED/);
    }
  });

  it("shows the mode in the header and a Mock / Real toggle: Mock pressed, Real DISABLED with the plain reason from the server", async () => {
    await h.mount();
    expect(text("mode")).toBe("Mock");
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    const info = await h.lab.json("/api/info");
    expect(real).toHaveAttribute("title", info.realReason);
    expect(text("real-reason")).toBe(info.realReason);
    expect(info.realReason).toMatch(/not built yet/);
  });

  it("the server's 409 for Real is shown as the server worded it (a stale page that still asks)", async () => {
    // a page that was told Real is available (the server still refuses it)
    const user = await h.mount({ overrides: { "/api/info": async (_init, _u, go) => { const r = await go(); return jsonResponse(200, { ...(await r.json()), realAvailable: true }); } } });
    const real = screen.getByTestId("mode-real");
    expect(real).not.toBeDisabled();
    await user.click(real);
    await waitFor(() => expect(screen.getByTestId("mode-error-banner")).toHaveTextContent(/not built yet/));
    expect(text("mode")).toBe("Mock");
    const posts = h.lab.calls.filter((c) => c.path === "/api/mode" && c.method === "POST");
    expect(posts.map((c) => c.body)).toEqual([{ source: "real" }]);
  });

  it("Mock switches back and all data is loaded again", async () => {
    const user = await h.mount();
    const before = h.lab.calls.filter((c) => c.path === "/api/info").length;
    await user.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(h.lab.calls.filter((c) => c.path === "/api/info").length).toBeGreaterThan(before));
    expect(h.lab.calls.some((c) => c.path === "/api/mode" && c.body?.source === "mock")).toBe(true);
  });

  it("names a server that is down instead of a blank page, and offers a retry", async () => {
    await h.mount({ overrides: { "/api/info": () => jsonResponse(502, { error: "bad_gateway", message: "The lab server did not answer." }) } }).catch(() => {});
    expect(await screen.findByTestId("load-error")).toHaveTextContent(/Could not load the lab/);
    expect(screen.getByTestId("retry")).toBeInTheDocument();
    expect(screen.getByTestId("banner").textContent.length).toBeGreaterThan(40);
  });

  it("presenter mode keeps the banner first and shows the talk-track line for the page; P toggles and Escape leaves", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("presenter"));
    expect(document.querySelector("main").firstElementChild).toBe(screen.getByTestId("banner"));
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/only claim taken from the 2026-11-21 release notes/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false"));
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    await nav(user, "Diagram");
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/Everything is simulated/);
    expect(screen.getByTestId("banner")).toBeInTheDocument();
  });

  it("the talk track dialog opens with every section, filled for the vertical", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("talk-track-toggle"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/Northwind Retail/).length).toBeGreaterThan(0);
    expect(dialog.textContent).toMatch(/The primary is down and the second model answers/);
    expect(dialog.textContent).not.toMatch(/\{\{/);
  });

  it("Reset clears the last run and says what it did", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Reset: the key is back/));
    await screen.findByTestId("result-empty");
    expect(h.lab.calls.some((c) => c.path === "/api/reset" && c.method === "POST")).toBe(true);
  });

  it("every page has a first-level heading and the page's own intro line", async () => {
    const user = await h.mount();
    for (const p of PAGES) { await nav(user, p); expect(screen.getByTestId("head-intro").textContent.length, p).toBeGreaterThan(30); }
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });
});
