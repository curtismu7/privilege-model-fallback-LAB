import { useCallback, useEffect, useMemo, useState } from "react";
import { getChain, getScenarios, putChain } from "../api";
import { Card, Chip, Loading } from "../components/Bits.jsx";
import ChainEditor, { chainProblems } from "./ChainEditor.jsx";
import Result from "./Result.jsx";
import { visible } from "../safeText";

const scenarioFromHash = () => { const parts = window.location.hash.replace("#", "").split("/"); return parts[0] === "fallback" && parts[1] ? parts[1] : null; };
const sameChain = (a, b) => a.length === b.length && a.every((e, i) => e.provider === b[i].provider && e.model === b[i].model && e.budgetTokens === b[i].budgetTokens);

export default function FallbackPage({ lab }) {
  const [view, setView] = useState(null); // the saved key (GET /api/chain)
  const [scenarios, setScenarios] = useState([]);
  const [draft, setDraft] = useState([]);
  const [timeoutMs, setTimeoutMs] = useState(3000);
  const [states, setStates] = useState([]);
  const [prompt, setPrompt] = useState(lab.info.defaultPrompt);
  const [saveError, setSaveError] = useState(null);
  const [runError, setRunError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const limits = lab.info.limits;

  const adopt = useCallback((body) => { setView(body); setDraft(body.chain.map((e) => ({ ...e }))); setTimeoutMs(body.timeoutMs); setStates(body.chain.map(() => "healthy")); }, []);

  useEffect(() => {
    let live = true;
    Promise.all([getChain(), getScenarios()]).then(([c, s]) => {
      if (!live) return;
      if (!c.ok || !s.ok) { setLoadError((!c.ok ? c : s).body?.message || "The key could not be loaded."); return; }
      adopt(c.body); setScenarios(s.body.scenarios);
    });
    return () => { live = false; };
  }, [adopt]);

  // "#fallback/<scenario>" (the Stories page, a shared link) runs that scenario once the page has loaded.
  useEffect(() => {
    const id = scenarioFromHash();
    if (id && scenarios.some((s) => s.id === id) && lab.last?.id !== id) runScenario(id);
  }, [scenarios.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const runScenario = async (id) => {
    setRunError(null);
    try { window.history.replaceState(null, "", `#fallback/${id}`); } catch { /* ignore */ }
    const r = await lab.runScenario(id);
    if (!r.ok) setRunError(r.message);
  };
  const run = async () => {
    setRunError(null);
    try { window.history.replaceState(null, "", "#fallback"); } catch { /* ignore */ }
    const r = await lab.runLive(prompt, states.slice(0, draft.length));
    if (!r.ok) setRunError(r.message);
    else { const c = await getChain(); if (c.ok) setView(c.body); }
  };
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const r = await putChain({ chain: draft.map(({ provider, model, budgetTokens }) => ({ provider, model, budgetTokens })), timeoutMs });
      if (!r.ok) { setSaveError(r.body?.message || `HTTP ${r.status}`); return; }
      setView(r.body); setDraft(r.body.chain.map((e) => ({ ...e }))); setTimeoutMs(r.body.timeoutMs);
    } finally { setSaving(false); }
  };
  const loadScenarioKey = (sc) => { setDraft(sc.chain.map((e) => ({ ...e }))); setTimeoutMs(sc.timeoutMs); setStates(sc.providerStates.concat(sc.chain.map(() => "healthy")).slice(0, sc.chain.length)); setPrompt(sc.prompt); setSaveError(null); };

  const dirty = useMemo(() => !!view && (!sameChain(draft, view.chain) || timeoutMs !== view.timeoutMs), [draft, timeoutMs, view]);
  const active = lab.last?.kind === "scenario" ? lab.last.id : null;
  const activeScenario = scenarios.find((s) => s.id === active);

  if (loadError) return <Card tone="warn" title="The key could not be loaded" testId="fallback-load-error"><p role="alert">{visible(loadError)}</p></Card>;
  if (!view) return <Loading />;

  return (
    <div className="stack">
      <section className="card" data-testid="scenarios" aria-label="Scenarios">
        <p className="kicker">Scenarios</p>
        <h2 className="card__title">Nine scripted runs, each with a hand-written expected result</h2>
        <div className="seg" role="group" aria-label="Scenarios">
          {scenarios.map((s) => <button key={s.id} type="button" aria-pressed={active === s.id} disabled={lab.busy} onClick={() => runScenario(s.id)} data-testid={`scenario-${s.id}`}>{s.title}</button>)}
        </div>
        {activeScenario ? (
          <p data-testid="scenario-summary">{visible(activeScenario.summary)}{" "}
            {activeScenario.preSpend.length === 0
              ? <button type="button" onClick={() => loadScenarioKey(activeScenario)} data-testid="scenario-load">Load this key into the form</button>
              : <span className="muted" data-testid="scenario-load-note">This scenario starts with budgets already spent ({activeScenario.preSpend.map((p) => `model ${p.position + 1}: ${p.tokens} tokens`).join(", ")}); the form cannot start a key part-spent, so its key is not offered to load.</span>}</p>
        ) : <p className="muted">A scenario runs on a fresh key and a fresh clock and never touches the key below.</p>}
      </section>

      <div className="cols cols--result">
        <div className="stack">
          <ChainEditor draft={draft} setDraft={setDraft} timeoutMs={timeoutMs} setTimeoutMs={setTimeoutMs} states={states} setStates={setStates}
            limits={limits} providers={view.knownProviders} stateOptions={view.providerStates} ledgers={view.ledgers} onSave={save} saving={saving} saveError={saveError} saved={!!view} dirty={dirty} />
          <section className="card" data-testid="prompt-card">
            <p className="kicker">Your run</p>
            <h2 className="card__title">Prompt</h2>
            <label>Prompt (up to {limits.maxPromptChars} characters)
              <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid="prompt" maxLength={limits.maxPromptChars + 1000} />
            </label>
            <div className="seg">
              <button type="button" className="primary" onClick={run} disabled={lab.busy || dirty || chainProblems(draft, timeoutMs, limits).any} data-testid="run">Run on this key</button>
              {dirty && <span className="muted" data-testid="run-hint">Save the key first: a run uses the saved key.</span>}
            </div>
            {runError && <p className="field-error" role="alert" data-testid="run-error">{visible(runError)}</p>}
          </section>
        </div>
        <div className="stack">
          <Result last={lab.last} obs={lab.obs} source={lab.source || "mock"} />
        </div>
      </div>
    </div>
  );
}
