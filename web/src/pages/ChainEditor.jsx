import { visible } from "../safeText";
import { Chip } from "../components/Bits.jsx";

// The key form: an ordered chain of 1 to MAX models (provider, model, budget) and the key's timeout, plus the state the next run gives each model's provider.
// The client catches the obvious mistakes so the visitor sees them next to the field; the server checks again and has the last word (its message is shown).
export function chainProblems(draft, timeoutMs, limits) {
  const rows = draft.map(() => []);
  const top = [];
  if (draft.length < 1) top.push("A key needs at least one model.");
  if (draft.length > limits.maxChain) top.push(`A chain has at most ${limits.maxChain} models.`);
  const seen = new Map();
  draft.forEach((e, i) => {
    const model = String(e.model ?? "");
    if (!model.trim()) rows[i].push("Model is required.");
    else if (model.length > 64) rows[i].push("Model is at most 64 characters.");
    const b = e.budgetTokens;
    if (!Number.isInteger(b) || b < 0 || b > limits.maxBudgetTokens) rows[i].push(`Budget is a whole number from 0 to ${limits.maxBudgetTokens}.`);
    const id = `${e.provider}/${model}`;
    if (model.trim() && seen.has(id)) { rows[i].push("The same provider and model appear twice in the chain."); rows[seen.get(id)].includes("The same provider and model appear twice in the chain.") || rows[seen.get(id)].push("The same provider and model appear twice in the chain."); } else seen.set(id, i);
  });
  if (!Number.isInteger(timeoutMs) || timeoutMs < limits.minTimeoutMs || timeoutMs > limits.maxTimeoutMs) top.push(`Timeout is a whole number from ${limits.minTimeoutMs} to ${limits.maxTimeoutMs} ms.`);
  return { rows, top, any: top.length > 0 || rows.some((r) => r.length > 0) };
}

export default function ChainEditor({ draft, setDraft, timeoutMs, setTimeoutMs, states, setStates, limits, providers, stateOptions, ledgers, onSave, saving, saveError, saved, dirty }) {
  const problems = chainProblems(draft, timeoutMs, limits);
  const edit = (i, patch) => setDraft(draft.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const remove = (i) => { setDraft(draft.filter((_, k) => k !== i)); setStates(states.filter((_, k) => k !== i)); };
  const add = () => {
    const used = new Set(draft.map((e) => `${e.provider}/${e.model}`));
    let n = draft.length + 1;
    while (used.has(`provider-a/model-${n}`)) n += 1;
    setDraft([...draft, { provider: providers[0], model: `model-${n}`, budgetTokens: 500 }]);
    setStates([...states, "healthy"]);
  };
  return (
    <section className="card" data-testid="chain-editor" aria-label="The key's model chain">
      <p className="kicker">The key</p>
      <h2 className="card__title">Chain of models, first choice first</h2>
      <p className="muted">The key names up to {limits.maxChain} models. A call tries them in order; each model has its own token budget. The key holds no credential in this lab.</p>
      <ol className="chain" data-testid="chain-rows">
        {draft.map((e, i) => {
          const ledger = ledgers?.[i];
          return (
            <li key={i} className="chain__row" data-testid={`chain-row-${i}`}>
              <p className="chain__pos"><span className="step-num">{i + 1}</span>{i === 0 ? "Primary" : `Fallback ${i}`}{ledger && saved && !dirty ? <span className="muted"> · {ledger.spent} of {ledger.limit} tokens spent</span> : null}</p>
              <div className="chain__fields">
                <label>Provider
                  <select value={e.provider} onChange={(ev) => edit(i, { provider: ev.target.value })} data-testid={`chain-provider-${i}`}>
                    {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label>Model
                  <input type="text" value={e.model} maxLength={200} onChange={(ev) => edit(i, { model: ev.target.value })} data-testid={`chain-model-${i}`} aria-invalid={problems.rows[i].length > 0 || undefined} />
                </label>
                <label>Budget (tokens)
                  <input type="number" min="0" max={limits.maxBudgetTokens} step="1" inputMode="numeric" value={Number.isNaN(e.budgetTokens) ? "" : e.budgetTokens} onChange={(ev) => edit(i, { budgetTokens: ev.target.value === "" ? NaN : Number(ev.target.value) })} data-testid={`chain-budget-${i}`} aria-invalid={problems.rows[i].length > 0 || undefined} />
                </label>
                <label>Provider state for the next run
                  <select value={states[i] ?? "healthy"} onChange={(ev) => setStates(draft.map((_, k) => (k === i ? ev.target.value : states[k] ?? "healthy")))} data-testid={`chain-state-${i}`}>
                    {stateOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => remove(i)} disabled={draft.length <= 1} data-testid={`chain-remove-${i}`} aria-label={`Remove model ${i + 1}`}>Remove</button>
              </div>
              {problems.rows[i].map((m) => <p key={m} className="field-error" role="alert" data-testid={`chain-error-${i}`}>{m}</p>)}
            </li>
          );
        })}
      </ol>
      <div className="seg">
        <button type="button" onClick={add} disabled={draft.length >= limits.maxChain} data-testid="chain-add">Add a fallback model{draft.length >= limits.maxChain ? ` (limit ${limits.maxChain})` : ""}</button>
        <label className="inline">Timeout (ms)
          <input type="number" min={limits.minTimeoutMs} max={limits.maxTimeoutMs} step="1" inputMode="numeric" value={Number.isNaN(timeoutMs) ? "" : timeoutMs} onChange={(ev) => setTimeoutMs(ev.target.value === "" ? NaN : Number(ev.target.value))} data-testid="chain-timeout" aria-label="Timeout in milliseconds" />
        </label>
        <button type="button" onClick={onSave} disabled={saving || problems.any} data-testid="chain-save">Save the key (fresh budgets)</button>
        {dirty ? <Chip state="warn" testId="chain-dirty">unsaved changes</Chip> : <Chip state="ok" testId="chain-saved">saved</Chip>}
      </div>
      {problems.top.map((m) => <p key={m} className="field-error" role="alert" data-testid="chain-top-error">{m}</p>)}
      {saveError && <p className="field-error" role="alert" data-testid="chain-save-error">The server refused this key: {visible(saveError)}</p>}
    </section>
  );
}
