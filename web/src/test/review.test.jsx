import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { validateConfig } from "../../../server/src/customer.js";
import { validWorkspace } from "../../../server/src/workspaces.js";
import { WORKSPACE_ID } from "../workspace.js";
import { dialogItems, paragraphs } from "../talk.js";
import { screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();
const customer = validateConfig({ vertical: "health", name: "Mounted Test Lab", cast: { brand: "Test Brand Co", keyName: "test-key" } });

describe("the configured customer vertical and cast reach the page (the first story load sends no vertical)", () => {
  it("first /api/story call has no vertical parameter; the page shows the configured vertical, name and cast override", async () => {
    await h.mount({ page: "stories", customer });
    await screen.findByTestId("story-grid");
    const first = h.lab.calls.find((c) => c.path === "/api/story");
    expect(first.search).toBe("");
    expect(text("stories-for")).toContain("Test Brand Co");
    expect(screen.getByTestId("vertical-select")).toHaveValue("health");
    expect(document.querySelector("h1").textContent).toBe("Mounted Test Lab");
    expect(text("story-say-S01")).toContain("test-key");
    expect(document.body.textContent).not.toContain("Northwind Retail");
  });

  it("the configured vertical survives Reset and a mode switch; another vertical shows that pack's own words, not the customer's brand", async () => {
    const user = await h.mount({ page: "stories", customer });
    await screen.findByTestId("story-grid");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Reset: the key is back/));
    await screen.findByTestId("story-grid");
    expect(text("stories-for")).toContain("Test Brand Co");
    await user.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(h.lab.calls.filter((c) => c.path === "/api/story").length).toBeGreaterThan(2));
    expect(h.lab.calls.filter((c) => c.path === "/api/story").slice(1).every((c) => c.search === "?vertical=health")).toBe(true);
    expect(text("stories-for")).toContain("Test Brand Co");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    await waitFor(() => expect(text("stories-for")).toContain("Fabrikam Bank"));
    expect(document.body.textContent).not.toContain("Test Brand Co");
  });
});

describe("Reset clears the scenario hash so the remount does not run the scenario again", () => {
  it("run S06 from its link, click Reset: 'No run yet', the hash is #fallback and no second scenario call is made", async () => {
    const user = await h.mount({ page: "fallback/both-budgets-exhausted" });
    await screen.findByTestId("verdict");
    expect(text("refusal-code")).toBe("all_budgets_exhausted");
    const runs = () => h.lab.calls.filter((c) => c.path.startsWith("/api/scenario/") && c.method === "POST").length;
    expect(runs()).toBe(1);
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    expect(screen.getByText("No run yet")).toBeInTheDocument();
    expect(window.location.hash).toBe("#fallback");
    await new Promise((r) => setTimeout(r, 400)); // the remounted page has loaded its scenarios by now
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(runs()).toBe(1);
  });

  it("a vertical change also drops the scenario part of the hash", async () => {
    const user = await h.mount({ page: "fallback/primary-down" });
    await screen.findByTestId("verdict");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    await waitFor(() => expect(window.location.hash).toBe("#fallback"));
  });
});

describe("the P presenter shortcut", () => {
  const on = () => screen.getByTestId("presenter").getAttribute("aria-pressed") === "true";
  it("ignores Ctrl, Cmd and Alt chords, a held key, a focused field and a focused button; a plain P on the page toggles", async () => {
    await h.mount();
    await screen.findByTestId("chain-editor");
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) { fireEvent.keyDown(window, { key: "p", ...mod }); expect(on(), JSON.stringify(mod)).toBe(false); }
    fireEvent.keyDown(screen.getByTestId("prompt"), { key: "p" }); expect(on(), "textarea").toBe(false);
    fireEvent.keyDown(screen.getByTestId("chain-model-0"), { key: "P" }); expect(on(), "input").toBe(false);
    fireEvent.keyDown(screen.getByTestId("chain-state-0"), { key: "p" }); expect(on(), "select").toBe(false);
    fireEvent.keyDown(screen.getByTestId("reset"), { key: "p" }); expect(on(), "button").toBe(false);
    fireEvent.keyDown(document.body, { key: "p" }); expect(on(), "plain p").toBe(true);
    fireEvent.keyDown(screen.getByTestId("presenter"), { key: "Escape" }); expect(on(), "Escape works with the Presenter button focused").toBe(false);
  });
});

describe("talk-track paragraphs", () => {
  it("helpers: one paragraph per blank line; a multi-paragraph section becomes continuation items for the vendored dialog", () => {
    expect(paragraphs("a\n\nb\n\n\nc ")).toEqual(["a", "b", "c"]);
    expect(paragraphs("")).toEqual([]);
    expect(dialogItems([{ id: "x", title: "T", say: "one" }, { id: "y", title: "U", say: "p1\n\np2\n\np3" }])).toEqual([
      { id: "x", title: "T", say: "one" }, { id: "y", title: "U", say: "p1" }, { id: "y-2", title: "U (continued)", say: "p2" }, { id: "y-3", title: "U (continued)", say: "p3" },
    ]);
  });

  it("the talk-track dialog shows one <p> per paragraph, with '(continued)' titles, and no paragraph holds a line break", async () => {
    const user = await h.mount();
    const story = await h.lab.json("/api/story");
    const want = story.talkTrack.reduce((n, t) => n + paragraphs(t.say).length, 0);
    expect(want).toBeGreaterThan(story.talkTrack.length);
    await user.click(screen.getByTestId("talk-track-toggle"));
    const dialog = await screen.findByRole("dialog");
    const ps = [...dialog.querySelectorAll("p")];
    expect(ps).toHaveLength(want);
    expect(ps.every((p) => !p.textContent.includes("\n"))).toBe(true);
    expect(within(dialog).getAllByText("Before you start (continued)")).toHaveLength(1);
  });

  it("presenter mode and the stories page draw a paragraph per <p>", async () => {
    const user = await h.mount();
    const story = await h.lab.json("/api/story");
    await user.click(screen.getByTestId("presenter"));
    const before = story.talkTrack.find((t) => t.id === "before-you-start");
    expect(paragraphs(before.say).length).toBeGreaterThan(1);
    expect(screen.getByTestId("presenter-say").querySelectorAll("p")).toHaveLength(paragraphs(before.say).length);
    expect(screen.getByTestId("presenter-say").textContent).not.toContain("\n");
    const talk = story.talkTrack.find((t) => t.id === "what-is-simulated-and-what-is-not");
    expect(paragraphs(talk.say).length).toBeGreaterThan(1);
    window.location.hash = "#limits";
    await waitFor(() => expect(screen.getByTestId("presenter-say").querySelectorAll("p")).toHaveLength(paragraphs(talk.say).length));
    window.location.hash = "#stories";
    await screen.findByTestId("talk-general");
    expect(within(screen.getByTestId("talk-general")).getByText("Before you start").parentElement.querySelectorAll("p")).toHaveLength(paragraphs(before.say).length);
    expect(story.stories.every((s) => screen.getByTestId(`story-say-${s.id}`).querySelectorAll("p").length === paragraphs(story.talkTrack.find((t) => t.id === s.id).say).length)).toBe(true);
  });
});

describe("the client's workspace id pattern is the server's", () => {
  it("same source text, and the same verdict on boundary ids", () => {
    expect(WORKSPACE_ID.source).toBe("^[a-z0-9][a-z0-9-]{0,31}$");
    for (const id of ["default", "w-0123456789abcdef", "a", "0", "a".repeat(32), "a".repeat(33), "a".repeat(40), "", "-x", "A", "a b", "a_b", "x".repeat(32) + "-"]) expect(WORKSPACE_ID.test(id), id).toBe(validWorkspace(id));
  });
});
