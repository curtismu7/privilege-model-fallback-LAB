// The "What Privilege did" trace for one run (rule 25), built from the engine's result with the vendored gatewayTrace.js (mockTrace).
// Step 1 is the app's call to the lab's mock gateway; its decisions are one per attempt (budget check, provider reply). Every provider call
// the gateway made is its own step with its own request and response. The lab's gateway computed every decision, so every basis is `checked`.
// Hosts are .example. The values shown as credentials are labelled lab mocks: the lab holds no credential for a key or a provider.
import { mockTrace } from './gatewayTrace.js';

const name = (a) => `${a.provider}/${a.model}`;
const GATEWAY_URL = 'https://gateway.lab.example/v1/chat';
const providerUrl = (provider) => `https://${provider}.lab.example/v1/chat`;

export function exchangesFor(result, { prompt, needed }) {
  const attempts = result.attempts;
  const decisions = [];
  for (const a of attempts) {
    const snap = result.ledgers[a.position];
    const before = snap.remaining + (a.ok ? a.tokens : 0);
    if (a.reason === 'out_of_budget') {
      decisions.push({ id: `budget-${a.position}`, label: `Budget of ${name(a)}`, outcome: 'info', evidence: `Out of budget: ${before} of ${snap.limit} tokens left, the call needs about ${needed}. Skipped without a provider call.` });
      continue;
    }
    decisions.push({ id: `budget-${a.position}`, label: `Budget of ${name(a)}`, outcome: 'pass', evidence: `${before} of ${snap.limit} tokens left, enough for the call (about ${needed}).` });
    decisions.push(a.ok
      ? { id: `provider-${a.position}`, label: `Provider call to ${name(a)}`, outcome: 'pass', evidence: `HTTP ${a.status} after ${a.latencyMs} ms; ${a.tokens} tokens charged to its own ledger.` }
      : { id: `provider-${a.position}`, label: `Provider call to ${name(a)}`, outcome: 'info', evidence: `Could not answer: HTTP ${a.status} (${a.error}) after ${a.latencyMs} ms. The next model is tried.` });
  }
  for (let p = attempts.length; p < result.ledgers.length; p++) {
    decisions.push({ id: `rest-${p}`, label: `${result.ledgers[p].provider}/${result.ledgers[p].model}`, outcome: 'skipped', evidence: 'Not tried: an earlier model answered.' });
  }
  if (!result.ok) decisions.push({ id: 'verdict', label: 'Result', outcome: 'fail', evidence: `Refused (${result.refusal.code}): no model could answer.` });

  const body = result.ok
    ? { ok: true, servedBy: result.servedBy, answer: result.answer, attempts: result.totals.attempts, note: 'Lab model: how the real response names the serving model is UNVERIFIED.' }
    : { ok: false, refusal: { code: result.refusal.code, message: result.refusal.message }, note: 'Lab model: the real refusal wording and status are UNVERIFIED; this lab returns a normal result.' };
  const first = {
    step: 1, title: `App to gateway: ${result.ok ? `answered by ${name(result.servedBy)}` : `refused (${result.refusal.code})`}`, status: 200,
    trace: mockTrace({ url: GATEWAY_URL, authorization: 'Bearer MOCK-key-1 (a lab mock value, not a credential)', rpc: { messages: [{ role: 'user', content: prompt }] }, status: 200, body, requestHeaders: { accept: null }, decisions }),
  };
  const calls = attempts.filter((a) => a.reason !== 'out_of_budget').map((a, i) => ({
    step: i + 2, title: `Gateway to provider: ${name(a)}`, status: a.status,
    trace: mockTrace({
      url: providerUrl(a.provider), authorization: 'Bearer MOCK-provider-credential (a lab mock value, not a credential)', requestHeaders: { accept: null },
      rpc: { model: a.model, messages: [{ role: 'user', content: prompt }] }, status: a.status,
      body: a.ok ? { model: a.model, text: result.answer, usage: { note: 'lab mock', tokens: a.tokens } } : { error: a.error },
      decisions: [{ id: 'reply', label: a.ok ? 'The provider answered' : 'The provider could not answer', outcome: a.ok ? 'pass' : 'fail', evidence: `HTTP ${a.status} after ${a.latencyMs} ms (lab mock provider).` }],
    }),
  }));
  return [first, ...calls];
}
