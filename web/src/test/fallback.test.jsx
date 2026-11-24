import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { SCENARIOS, runScenario } from "../../../server/src/scenarios.js";
import { screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();
const name = (m) => `${m.provider}/${m.model}`;

describe("Fallback page: scenarios", () => {
  it("has a button for each of the nine scenarios and an empty state before any run", async () => {
    await h.mount();
    expect(SCENARIOS).toHaveLength(9);
    await screen.findByTestId("scenarios");
    for (const s of SCENARIOS) expect(screen.getByTestId(`scenario-${s.id}`)).toHaveTextContent(s.title);
    expect(screen.getByTestId("result-empty")).toBeInTheDocument();
    expect(screen.getByTestId("gateway-trace-empty")).toBeInTheDocument();
    expect(screen.getByTestId("ro-empty")).toBeInTheDocument();
  });

  for (const s of SCENARIOS) {
    it(`scenario ${s.id}: the UI verdict equals the engine's expected result`, async () => {
      const user = await h.mount();
      await user.click(await screen.findByTestId(`scenario-${s.id}`));
      await screen.findByTestId("verdict");
      const want = runScenario(s.id);
      expect(want.pass).toBe(true);
      if (s.expect.ok) {
        expect(text("verdict-chip")).toBe("ANSWERED");
        expect(text("served-by")).toBe(name(want.result.servedBy));
        expect(want.result.servedBy.position).toBe(s.expect.servedPosition);
        if (s.expect.servedProvider) expect(text("served-by")).toContain(s.expect.servedProvider);
      } else {
        expect(text("verdict-chip")).toBe("REFUSED");
        expect(text("refusal-code")).toBe(s.expect.refusalCode);
        for (const a of want.result.attempts) expect(text("refusal-message")).toContain(name(a));
      }
      // the attempts table has the expected reasons in order, the budgets match the spend, and the verdict says it equals the expectation
      expect(screen.getAllByTestId(/^attempt-\d+$/)).toHaveLength(s.expect.reasons.length);
      const reasonsShown = screen.getAllByTestId(/^attempt-\d+$/).map((r) => r.textContent);
      s.expect.reasons.forEach((reason, i) => expect(reasonsShown[i], reason).toMatch(reason === "served" ? /served/ : reason === "out_of_budget" ? /out of budget/ : reason === "provider_down" ? /down/ : reason === "provider_overloaded" ? /overloaded/ : /timed out/));
      s.expect.spent.forEach((n, i) => expect(screen.getByTestId(`meter-${i}`)).toHaveTextContent(new RegExp(`^.*${n} of \\d+ tokens spent`)));
      expect(text("expectation")).toMatch(/matches the expectation/);
      expect(text("verdict")).toContain(s.title);
    });
  }

  it("after a scenario: the trace panel shows every hop and the run-behind panel lists simulated rows, each through the shared components", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-down"));
    await screen.findByTestId("verdict");
    expect(await screen.findByTestId("trace-1")).toBeInTheDocument();
    expect(screen.getByTestId("trace-2")).toBeInTheDocument();
    expect(screen.getByTestId("trace-3")).toBeInTheDocument();
    expect(text("gateway-trace-basis")).toMatch(/Simulated/);
    await waitFor(() => expect(screen.queryByTestId("ro-empty")).toBeNull());
    expect(text("ro-basis")).toMatch(/None of them was read from a product log/);
    expect(screen.getByTestId("obs-note").textContent).toMatch(/Person, Authorize and Agent gateway have nothing to log here/);
    expect(document.querySelectorAll(".json, .jp, [data-testid^='trace-'][data-testid$='-request']").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Bearer eyJ/)).toBeNull();
  });

  it("a scenario never touches the live key", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-primary-healthy"));
    await screen.findByTestId("verdict");
    expect((await h.lab.json("/api/chain")).ledgers.map((l) => l.spent)).toEqual([0, 0]);
  });

  it("'#fallback/<scenario>' runs that scenario when the page opens (the Stories page's Show it)", async () => {
    await h.mount({ page: "fallback/both-budgets-exhausted" });
    await screen.findByTestId("verdict");
    expect(text("refusal-code")).toBe("all_budgets_exhausted");
    expect(screen.getByTestId("scenario-both-budgets-exhausted")).toHaveAttribute("aria-pressed", "true");
  });

  it("a scenario's key can be loaded into the form", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-fallback-different-provider"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("scenario-load"));
    expect(screen.getByTestId("chain-provider-1")).toHaveValue("provider-b");
    expect(screen.getByTestId("chain-model-1")).toHaveValue("model-b-small");
    expect(screen.getByTestId("chain-state-0")).toHaveValue("down");
    expect(screen.getByTestId("chain-dirty")).toBeInTheDocument();
  });
});

describe("Fallback page: your own key and run", () => {
  it("runs on the saved key with a provider state per model: down primary, the second model answers and is charged on its own ledger", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.selectOptions(screen.getByTestId("chain-state-0"), "down");
    await user.clear(screen.getByTestId("prompt"));
    await user.type(screen.getByTestId("prompt"), "hello there friend");
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(text("served-by")).toBe("provider-a/model-a-small");
    expect(text("verdict")).toContain("Your run on the live key");
    expect(screen.queryByTestId("expectation")).toBeNull();
    expect(screen.getByTestId("meter-0")).toHaveTextContent("0 of 1000 tokens spent");
    expect(screen.getByTestId("meter-1")).toHaveTextContent("123 of 500 tokens spent");
    await waitFor(() => expect(screen.getByTestId("chain-row-1")).toHaveTextContent("123 of 500 tokens spent"));
    // a second run charges the same ledger again, a healthy primary answers now and the fallback is not charged
    await user.selectOptions(screen.getByTestId("chain-state-0"), "healthy");
    await user.click(screen.getByTestId("run"));
    await waitFor(() => expect(text("served-by")).toBe("provider-a/model-a-large"));
  });

  it("an empty prompt is a 400 from the server, shown by name; nothing is claimed as a run", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.clear(screen.getByTestId("prompt"));
    await user.click(screen.getByTestId("run"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent(/prompt must not be empty/);
    expect(screen.getByTestId("result-empty")).toBeInTheDocument();
  });

  it("a too-long prompt is a 400 from the server", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    fireEvent.change(screen.getByTestId("prompt"), { target: { value: "x".repeat(20001) } });
    await user.click(screen.getByTestId("run"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent(/over 20000 characters/);
  });

  it("an unreachable server is named in the result area, not left blank", async () => {
    const user = await h.mount({ overrides: { "/api/run": () => { throw new TypeError("fetch failed"); } } });
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("run"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent(/did not answer/);
  });
});
