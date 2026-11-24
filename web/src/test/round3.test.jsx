import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { FORGOTTEN_EVENT, forgetWorkspace, noteFreshness, workspaceId } from "../workspace.js";
import { jsonResponse } from "./harness.js";
import { screen, text, useLabHarness, waitFor } from "./util.jsx";

const h = useLabHarness();

describe("Diagram: the keyboard works inside an expanded box", () => {
  it("the label is a real button: Enter and Space open and close it; Close, Copy link and Outgoing work from the keyboard", async () => {
    const user = await h.mount({ page: "diagram" });
    const label = await screen.findByTestId("pat-label-gw");
    expect(label.tagName).toBe("BUTTON");
    expect(label).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("pat-node-gw")).not.toHaveAttribute("role"); // no role=button wrapper around interactive children
    label.focus(); await user.keyboard("{Enter}");
    expect(await screen.findByTestId("dk-passport-gw")).toBeInTheDocument();
    expect(label).toHaveAttribute("aria-expanded", "true");
    // Close, from the keyboard (this was swallowed by the wrapper's key handler)
    const close = screen.getByTestId("dk-passport-close");
    close.focus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByTestId("dk-passport-gw")).toBeNull());
    // Space on the label opens it again
    label.focus(); await user.keyboard(" ");
    await screen.findByTestId("dk-passport-gw");
    // Copy link by Enter and by Space: not swallowed, does not close the box
    const copy = screen.getByTestId("dk-passport-copy");
    copy.focus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("dk-passport-gw")).toBeInTheDocument());
    expect(fireEvent.keyDown(screen.getByTestId("dk-passport-copy"), { key: " " })).toBe(true); // nothing called preventDefault
    expect(fireEvent.keyDown(screen.getByTestId("dk-passport-close"), { key: "Enter" })).toBe(true);
    // Outgoing: opens the box at the far end
    const go = screen.getByTestId("dk-passport-outgoing").querySelector("button");
    go.focus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByTestId("dk-passport-gw")).toBeNull());
    expect(document.querySelectorAll("[data-testid^='dk-passport-']:not([data-testid^='dk-passport-c']):not([data-testid*='out']):not([data-testid*='in']):not([data-testid*='reach']):not([data-testid*='sources'])").length).toBeGreaterThan(0);
  });

  it("a click on the label toggles it once (not twice)", async () => {
    await h.mount({ page: "diagram" });
    // (fireEvent, not userEvent: userEvent's mousedown carries no `view`, and React Flow's d3 drag handler reads view.document)
    fireEvent.click(await screen.findByTestId("pat-label-primary"));
    expect(await screen.findByTestId("dk-passport-primary")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pat-label-primary"));
    await waitFor(() => expect(screen.queryByTestId("dk-passport-primary")).toBeNull());
  });

  it("a shared link's ?box= opens that box once and is taken out of the address: Reset does not open it again", async () => {
    window.history.replaceState(null, "", "/?box=gw");
    try {
      const user = await h.mount({ page: "diagram" });
      expect(await screen.findByTestId("dk-passport-gw")).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe(""));
      expect(window.location.hash).toBe("#diagram");
      await user.click(screen.getByTestId("reset"));
      await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Reset: the key is back/));
      await screen.findByTestId("pattern-canvas");
      expect(screen.queryByTestId("dk-passport-gw")).toBeNull();
    } finally { window.history.replaceState(null, "", "/"); }
  });
});

describe("Escape leaves presenter mode from inside a field; P still does not", () => {
  it("Escape in a textarea exits, P in a textarea does not toggle", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("presenter"));
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByTestId("prompt"), { key: "p" });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByTestId("prompt"), { key: "Escape" });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("a failed vertical load leaves the old vertical in place", () => {
  it("the picker keeps the old value and the page, the load error is shown, Try again recovers", async () => {
    const overrides = { "/api/story": (_i, u) => (u.searchParams.get("vertical") === "finance" ? jsonResponse(500, { error: "internal", message: "the story could not be built" }) : null) };
    const user = await h.mount({ page: "stories", overrides });
    await screen.findByTestId("story-grid");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    expect(await screen.findByTestId("load-error")).toHaveTextContent(/the story could not be built/);
    expect(screen.getByTestId("vertical-select")).toHaveValue("retail");
    expect(text("stories-for")).toContain("Northwind Retail");
    await user.click(screen.getByTestId("retry"));
    await waitFor(() => expect(screen.queryByTestId("load-error")).toBeNull());
    expect(screen.getByTestId("vertical-select")).toHaveValue("retail");
    await user.selectOptions(screen.getByTestId("vertical-select"), "health");
    await waitFor(() => expect(screen.getByTestId("vertical-select")).toHaveValue("health"));
    expect(text("stories-for")).toContain("Contoso Health");
  });
});

describe("the server forgot this workspace", () => {
  it("noteFreshness: the first 1 is the tab's own first request (silent); a 1 after the tab has used its id is a forgotten workspace; 0 and no header say nothing", () => {
    forgetWorkspace(); workspaceId();
    const seen = []; const on = () => seen.push("forgotten"); window.addEventListener(FORGOTTEN_EVENT, on);
    try {
      noteFreshness(null); noteFreshness("0"); expect(seen).toEqual([]);
      forgetWorkspace(); workspaceId();
      noteFreshness("1"); expect(seen).toEqual([]);
      noteFreshness("0"); noteFreshness("0"); expect(seen).toEqual([]);
      noteFreshness("1"); expect(seen).toEqual(["forgotten"]);
      noteFreshness(undefined); noteFreshness("2"); expect(seen).toEqual(["forgotten"]);
    } finally { window.removeEventListener(FORGOTTEN_EVENT, on); forgetWorkspace(); }
  });

  it("evict the tab's workspace (21 others) and press Run: a plain banner, the form reloads the server's default key, nothing is claimed as the user's key", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("chain-remove-1")); // the tab's own key: one model
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
    await waitFor(() => expect(h.lab.calls.at(-1).path).toBe("/api/chain")); // the page's own follow-up reads of the run are done: the tab's workspace is now the least recently used
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 20; i += 1) await fetch(`${h.lab.base}/api/chain`, { headers: { "x-workspace": `evict-${i}` } });
    await user.click(screen.getByTestId("run"));
    expect(await screen.findByTestId("workspace-forgotten")).toHaveTextContent("The server forgot this workspace; the lab was reset to its defaults.");
    await waitFor(() => expect(screen.getAllByTestId(/^chain-row-\d$/)).toHaveLength(2), { timeout: 6000 }); // the form shows the key the server really has
    expect(screen.getByTestId("chain-saved")).toBeInTheDocument();
    await user.click(screen.getByTestId("workspace-forgotten-dismiss"));
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
    // a deliberate Reset afterwards is not a forgotten workspace
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("verdict");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });

  it("an ordinary session never shows it: first load, runs, a scenario, Reset, a vertical change", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down")); await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("run")); await waitFor(() => expect(screen.getByTestId("verdict")).toBeInTheDocument());
    await user.click(screen.getByTestId("reset")); await screen.findByTestId("result-empty");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    await screen.findByTestId("scenarios");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });
});
