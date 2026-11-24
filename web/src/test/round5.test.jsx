import { describe, expect, it } from "vitest";
import { screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();

describe("the version button opens THIS lab's own notes, never another lab's release notes", () => {
  it("About this lab: the lab's name and version, the server's sourced claims, Mock only, Real not built, a link to Limits; no 'Token Workbench'", async () => {
    const user = await h.mount();
    const info = await h.lab.json("/api/info");
    await user.click(screen.getByTestId("version"));
    const dialog = await screen.findByTestId("about-dialog");
    expect(screen.queryByTestId("release-notes")).toBeNull();
    const t = dialog.textContent;
    expect(t).not.toMatch(/Token Workbench/i);
    for (const bad of [/JWKS/i, /introspection/i, /FAPI/i, /Wrong-token/i, /PingFederate/i]) expect(t).not.toMatch(bad);
    expect(t).toContain(info.lab); expect(t).toContain(`v${info.version}`);
    expect(t).toMatch(/Mock only/); expect(t).toMatch(/UNVERIFIED/);
    for (const c of info.sourced) expect(t).toContain(c);
    expect(within(dialog).getByTestId("about-real")).toHaveTextContent(/Real mode is not built yet/);
    await user.click(within(dialog).getByTestId("about-limits-link"));
    await waitFor(() => expect(window.location.hash).toBe("#limits"));
    await waitFor(() => expect(screen.queryByTestId("about-dialog")).toBeNull());
    expect(await screen.findByTestId("limits-sourced")).toBeInTheDocument();
  });

  it("the version button toggles it (and never opens the shared ReleaseNotes dialog)", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("version")); await screen.findByTestId("about-dialog");
    await user.click(screen.getByTestId("version")); await waitFor(() => expect(screen.queryByTestId("about-dialog")).toBeNull());
    expect(screen.queryByTestId("release-notes")).toBeNull();
  });
});

describe("a Run from a forgotten workspace whose saved key had more models than the default", () => {
  it("the banner fires, the form reloads the default key, the old states are gone, and the next Run works (no 400 loop)", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("chain-add")); await user.click(screen.getByTestId("chain-add"));
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^chain-row-\d$/)).toHaveLength(4);
    await user.click(screen.getByTestId("run")); await screen.findByTestId("verdict");
    await new Promise((r) => setTimeout(r, 600));
    for (let i = 0; i < 20; i += 1) await fetch(`${h.lab.base}/api/chain`, { headers: { "x-workspace": `evict-${i}` } });
    await user.click(screen.getByTestId("run")); // four states for a workspace the server no longer has
    expect(await screen.findByTestId("workspace-forgotten")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId(/^chain-row-\d$/)).toHaveLength(2), { timeout: 6000 });
    expect(screen.queryByTestId("run-error")).toBeNull();
    await user.click(screen.getByTestId("run"));
    await waitFor(() => expect(text("verdict-chip")).toBe("ANSWERED"));
    expect(screen.queryByTestId("run-error")).toBeNull();
  });
});
