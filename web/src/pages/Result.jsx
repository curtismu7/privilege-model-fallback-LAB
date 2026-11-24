import { useEffect, useRef } from "react";
import { visible } from "../safeText";
import { Card, Chip, HOT, Json } from "../components/Bits.jsx";
import Meter from "../components/Meter.jsx";
import GatewayTrace from "../gateway-trace/GatewayTrace.jsx";
import RunObservability from "../run-observability/RunObservability.jsx";
import { ms, reasonText } from "../fmt";

const name = (m) => `${m.provider}/${m.model}`;

// The verdict first: which model served, or the NAMED refusal. For a scenario, whether the result equals the scenario's hand-written expectation.
export function Verdict({ body, scenario }) {
  const served = body.servedBy; // body is the engine's result; scenario (or null) is the scenario's own verdict
  return (
    <Card tone={body.ok ? "ok" : "warn"} kicker={scenario ? `Scenario: ${scenario.title}` : "Your run on the live key"} testId="verdict">
      {body.ok ? (
        <>
          <h2 className="card__title"><Chip state="ok" testId="verdict-chip">ANSWERED</Chip> by <code data-testid="served-by">{visible(name(served))}</code></h2>
          <p data-testid="verdict-line">{served.position === 0 ? "The primary model answered; the fallback was never tried." : `The primary could not answer, so model ${served.position + 1} of ${body.ledgers.length} (a fallback) answered, and the answer names it.`}</p>
          <dl className="kv">
            <dt>Serving model</dt><dd>{visible(name(served))} (position {served.position + 1})</dd>
            <dt>Attempts</dt><dd data-testid="verdict-attempts">{body.totals.attempts}</dd>
            <dt>Lab time</dt><dd>{ms(body.totals.latencyMs)}</dd>
            <dt>Tokens charged</dt><dd>{body.totals.tokensCharged}, to the serving model's own ledger</dd>
            <dt>Answer (lab mock)</dt><dd><code>{visible(body.answer)}</code></dd>
          </dl>
        </>
      ) : (
        <>
          <h2 className="card__title"><Chip state="warn" testId="verdict-chip">REFUSED</Chip> <code data-testid="refusal-code">{visible(body.refusal.code)}</code></h2>
          <p data-testid="refusal-message">{visible(body.refusal.message)}</p>
          <dl className="kv">
            <dt>Budgets that ran out</dt>
            <dd data-testid="refusal-budgets">{body.refusal.budgetsExhausted.length ? body.refusal.budgetsExhausted.map((b) => `${name(b)} (${b.remaining} of ${b.limit} left, needs about ${b.neededTokens})`).join("; ") : "none"}</dd>
            <dt>Providers that failed</dt>
            <dd data-testid="refusal-providers">{body.refusal.providersFailed.length ? body.refusal.providersFailed.map((p) => `${name(p)} (HTTP ${p.status}, ${p.error})`).join("; ") : "none"}</dd>
            <dt>Fallback configured</dt><dd>{body.refusal.fallbackConfigured ? "yes" : "no: the key has one model"}</dd>
            <dt>Charged</dt><dd>{body.totals.tokensCharged} tokens</dd>
          </dl>
          <p className="muted">The refusal wording and status are this lab's own and UNVERIFIED. The lab returns it as a normal result (ok false) and does not imitate a status.</p>
        </>
      )}
      {scenario && (
        <p data-testid="expectation" className={scenario.pass ? undefined : "field-error"} role={scenario.pass ? undefined : "alert"}>
          <Chip state={scenario.pass ? "ok" : "bad"}>{scenario.pass ? "matches the expectation" : "differs from the expectation"}</Chip>{" "}
          {scenario.pass ? "The result equals the scenario's hand-written expectation." : visible(scenario.mismatches.join("; "))}
        </p>
      )}
    </Card>
  );
}

export function Attempts({ attempts }) {
  return (
    <section className="card card--neutral" data-testid="attempts" aria-label="Attempts">
      <p className="kicker">Every attempt, in order</p>
      <div className="scroll">
        <table className="tbl tbl--wide">
          <caption className="sr-only">Attempts</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Model</th><th scope="col">Outcome</th><th scope="col">HTTP</th><th scope="col">Latency</th><th scope="col">Tokens</th></tr></thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.position} data-testid={`attempt-${a.position}`}>
                <td>{a.position + 1}</td>
                <td><code>{visible(name(a))}</code></td>
                <td><Chip state={a.ok ? "ok" : a.reason === "out_of_budget" ? "warn" : "bad"} wrap>{reasonText(a.reason)}</Chip></td>
                <td>{a.status ?? "none"}</td>
                <td>{ms(a.latencyMs)}</td>
                <td>{a.tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const BASIS = "Simulated: the lab's own mock gateway computed every decision, so each is marked checked. The hosts are .example names and the credentials shown are lab mocks, never real ones. How the real product words its response is UNVERIFIED.";

// Everything one run left: the verdict, the attempts, the budgets, the trace, what the run left behind and the raw result.
export default function Result({ last, obs, source }) {
  const top = useRef(null);
  const runId = last?.runId;
  // On a narrow screen the result sits below the form: bring the verdict into view when a run finishes.
  useEffect(() => { if (runId && top.current && window.matchMedia?.("(max-width: 900px)").matches) top.current.scrollIntoView({ block: "start" }); }, [runId]);
  if (!last) {
    return (
      <Card tone="neutral" kicker="Result" title="No run yet" testId="result-empty">
        <p>Pick a scenario above or press Run on your own key. The verdict (which model answered, or the named refusal) appears here first, then every attempt, the budgets, the gateway trace and what the run left behind.</p>
        <GatewayTrace exchanges={[]} source="mock" title="What the gateway did (simulated)" basisNote={BASIS} />
        <RunObservability record={null} source={source} streams={obs?.streams || []} />
      </Card>
    );
  }
  const { result: body, trace, scenario } = last; // the trace and the record are shown by their own panels below
  return (
    <div className="stack" data-testid="result" data-run={runId} ref={top}>
      <Verdict body={body} scenario={scenario || null} />
      <Attempts attempts={body.attempts} />
      <section className="card card--neutral" data-testid="meters" aria-label="Budgets">
        <p className="kicker">Budget per model, after this run</p>
        <ul className="meters">{body.ledgers.map((l) => <Meter key={l.position} ledger={l} />)}</ul>
        <p className="muted">Only the model that served is charged, on its own ledger. A model that was skipped or that failed is not charged.{scenario ? " A scenario runs on a fresh key and clock; the live key is untouched." : ""}</p>
      </section>
      <GatewayTrace exchanges={trace?.exchanges || []} source="mock" title="What the gateway did (simulated)" basisNote={BASIS} hot={["error", "ok", "refusal", "servedBy"]} />
      <RunObservability record={obs?.record ?? null} source={source} streams={obs?.streams || []} title="What this run left behind" />
      <p className="muted" data-testid="obs-note">In this lab: Agent is the calling app, Privilege is the lab's model of the LLM gateway (its budget decisions), Resource server is the model provider. Person, Authorize and Agent gateway have nothing to log here and the panel says so. Times are when the lab computed them.</p>
      <details className="card card--neutral" data-testid="raw-result">
        <summary>The raw result</summary>
        <Json value={scenario ? { scenario, result: body } : body} label="The raw result" hot={HOT} />
      </details>
    </div>
  );
}
