import { describe, expect, it } from "vitest";
import { chainProblems, MODEL_ID } from "../pages/ChainEditor.jsx";
import { jsonResponse } from "./harness.js";
import { screen, text, useLabHarness, userEvent, waitFor } from "./util.jsx";
import { fireEvent } from "@testing-library/react";

const h = useLabHarness();
const LIMITS = { maxChain: 5, maxBudgetTokens: 1000000, minTimeoutMs: 500, maxTimeoutMs: 60000 };
const LONG = `long-model-name-${"x".repeat(40)}`; // 56 characters; with "-4" 58, inside the 64-character limit

describe("the key form: validation", () => {
  it("chainProblems: empty and long model, bad budgets, duplicates, too many models, bad timeout", () => {
    const row = (model, budgetTokens = 100, provider = "provider-a") => ({ provider, model, budgetTokens });
    expect(chainProblems([row("a")], 3000, LIMITS).any).toBe(false);
    expect(chainProblems([row("")], 3000, LIMITS).rows[0]).toContain("Model is required.");
    expect(chainProblems([row("x".repeat(65))], 3000, LIMITS).rows[0]).toContain("Model is at most 64 characters.");
    for (const bad of [-1, 1.5, 1000001, NaN]) expect(chainProblems([row("a", bad)], 3000, LIMITS).rows[0].join()).toMatch(/whole number from 0 to 1000000/);
    const dup = chainProblems([row("a"), row("a")], 3000, LIMITS);
    expect(dup.rows[0].join()).toMatch(/twice/); expect(dup.rows[1].join()).toMatch(/twice/);
    expect(chainProblems([row("a"), row("a", 1, "provider-b")], 3000, LIMITS).any).toBe(false);
    expect(chainProblems([], 3000, LIMITS).top.join()).toMatch(/at least one/);
    expect(chainProblems(Array.from({ length: 6 }, (_, i) => row(`m${i}`)), 3000, LIMITS).top.join()).toMatch(/at most 5/);
    expect(chainProblems([row("a")], 499, LIMITS).top.join()).toMatch(/Timeout/);
    expect(chainProblems([row("a")], 500, LIMITS).any).toBe(false);
  });

  it("the chain grows to five models and stops there; Remove keeps at least one", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId("chain-add"));
    expect(screen.getAllByTestId(/^chain-row-\d$/)).toHaveLength(5);
    expect(screen.getByTestId("chain-add")).toBeDisabled();
    expect(screen.getByTestId("chain-add")).toHaveTextContent(/limit 5/);
    while (screen.queryByTestId("chain-remove-1")) await user.click(screen.getByTestId("chain-remove-1"));
    expect(screen.getAllByTestId(/^chain-row-\d$/)).toHaveLength(1);
    expect(screen.getByTestId("chain-remove-0")).toBeDisabled();
  });

  it("five long model names are saved, the key keeps them and a run names the serving model in full", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId("chain-add"));
    for (let i = 0; i < 5; i++) fireEvent.change(screen.getByTestId(`chain-model-${i}`), { target: { value: `${LONG}-${i}` } });
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    expect(screen.getByTestId("chain-model-4")).toHaveValue(`${LONG}-4`);
    await user.selectOptions(screen.getByTestId("chain-state-0"), "down");
    await user.selectOptions(screen.getByTestId("chain-state-1"), "overloaded");
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(text("served-by")).toBe(`provider-a/${LONG}-2`);
    expect(screen.getAllByTestId(/^attempt-\d+$/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^meter-\d$/)).toHaveLength(5);
  });

  it("a client-side error blocks Save and is shown next to the field", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.clear(screen.getByTestId("chain-model-1"));
    expect(screen.getByTestId("chain-error-1")).toHaveTextContent("Model is required.");
    expect(screen.getByTestId("chain-save")).toBeDisabled();
    expect(screen.getByTestId("run")).toBeDisabled();
    fireEvent.change(screen.getByTestId("chain-budget-0"), { target: { value: "-5" } });
    expect(screen.getByTestId("chain-error-0")).toHaveTextContent(/whole number from 0 to 1000000/);
  });

  it("the form already refuses a model id the server would refuse (the server's own pattern), next to the field", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    for (const bad of ["bad model!", "-leading", ".dot", "a/b", "über"]) {
      expect(MODEL_ID.test(bad), bad).toBe(false);
      await user.clear(screen.getByTestId("chain-model-0"));
      await user.type(screen.getByTestId("chain-model-0"), bad);
      expect(screen.getByTestId("chain-error-0"), bad).toHaveTextContent(/letters, digits, dots, dashes or underscores, starting with a letter or digit/);
      expect(screen.getByTestId("chain-save")).toBeDisabled();
    }
    for (const good of ["a", "model-a.v2_x", "A".repeat(64)]) expect(MODEL_ID.test(good), good).toBe(true);
    expect(MODEL_ID.test("a".repeat(65))).toBe(false);
  });

  it("a 400 from the server for a key (a limit the page does not know) is shown in full; the saved key is unchanged", async () => {
    const overrides = { "/api/chain": (init) => (init.method === "PUT" ? jsonResponse(400, { error: "bad_model", message: "model must be 1 to 64 letters, digits, dots, dashes or underscores" }) : null) };
    const user = await h.mount({ overrides });
    await screen.findByTestId("chain-editor");
    await user.type(screen.getByTestId("chain-model-0"), "x");
    await user.click(screen.getByTestId("chain-save"));
    expect(await screen.findByTestId("chain-save-error")).toHaveTextContent(/The server refused this key: model must be 1 to 64 letters, digits, dots, dashes or underscores/);
    expect((await h.lab.json("/api/chain")).chain[0].model).toBe("model-a-large");
    expect(screen.getByTestId("chain-dirty")).toBeInTheDocument();
    expect(screen.getByTestId("run-hint")).toHaveTextContent(/Save the key first/);
  });

  it("a zero budget is allowed and a run on it says out of budget at once", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    fireEvent.change(screen.getByTestId("chain-budget-0"), { target: { value: "0" } });
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(text("served-by")).toBe("provider-a/model-a-small");
    expect(screen.getByTestId("attempt-0")).toHaveTextContent(/out of budget/);
    expect(screen.getByTestId("meter-0")).toHaveTextContent(/0 of 0 tokens spent/);
  });

  it("a one-model key that is down is refused with no_fallback_configured, named", async () => {
    const user = await h.mount();
    await screen.findByTestId("chain-editor");
    await user.click(screen.getByTestId("chain-remove-1"));
    await user.click(screen.getByTestId("chain-save"));
    await waitFor(() => expect(screen.getByTestId("chain-saved")).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId("chain-state-0"), "down");
    await user.click(screen.getByTestId("run"));
    await screen.findByTestId("verdict");
    expect(text("refusal-code")).toBe("no_fallback_configured");
    expect(text("refusal-providers")).toMatch(/HTTP 503/);
    expect(userEvent).toBeTruthy();
  });
});
