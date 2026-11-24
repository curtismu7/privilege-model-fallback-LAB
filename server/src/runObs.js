// Rule 27: this lab's side of the shared run-observability panel. Pure functions around the vendored collector (runObservability.js, never
// edited here): the events one run leaves behind, the one stdout line each decision writes, and the record builder.
//
// Mock only: every row is `simulated` and is an event this lab's own mock computed on this run (nothing is invented; a layer the mock never
// touched says so). The lab reads no logs, so only the collector core is vendored (no readers file). Time = when the lab computed it: the
// run's wall-clock start plus the lab clock's offsets (the attempts' latencies), so the rows and the stdout lines carry the same instants.
import { createRunObservability, LAYERS } from './runObservability.js';

export const SERVICE = 'privilege-model-fallback-lab';
export const MAX_RUNS = 20;
const ID = /[^A-Za-z0-9._:/@-]/g;
const idText = (v) => String(v == null || v === '' ? '-' : v).replace(ID, '_').slice(0, 64);

// One timestamped line per decision: actor and outcome, never a prompt or a key. Words a shared matcher reads as a decision are avoided
// on purpose (the result is passed / stopped / unclear, the step is a short id).
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };
export const decisionLine = (e, runId) => `${e.at} ${SERVICE} decision step=${idText(e.step)} actor=${idText(e.actor)} result=${RESULT[e.outcome] || 'unclear'} run=${idText(runId)}`;

const iso = (ms) => new Date(ms).toISOString();
const name = (a) => `${a.provider}/${a.model}`;

// result: the engine's result for the run; needed: tokens the call was expected to cost; baseMs: wall-clock ms at the start of the run.
export function eventsFor(result, { needed, baseMs }) {
  const ev = [];
  const push = (offset, e) => ev.push({ ...e, at: iso(baseMs + offset) });
  let offset = 0;
  push(0, { layer: 'agent', step: 'request', actor: 'app', outcome: 'info', message: 'The app called the gateway with its LLM key (key-1). The lab holds no credential for it.', detail: { key: 'key-1', chain: result.ledgers.map((l) => `${l.provider}/${l.model}`) } });
  for (const a of result.attempts) {
    const snap = result.ledgers[a.position];
    const before = snap.remaining + (a.ok ? a.tokens : 0); // the ledger only moves when this model serves
    const budget = { position: a.position, limit: snap.limit, remainingBefore: before, neededTokens: needed };
    if (a.reason === 'out_of_budget') {
      push(offset, { layer: 'privilege', step: 'budget-check', actor: name(a), outcome: 'refused', message: `Budget check: ${name(a)} has ${before} of ${snap.limit} tokens left and the call needs about ${needed}, so it is skipped without a provider call.`, detail: budget });
      continue;
    }
    push(offset, { layer: 'privilege', step: 'budget-check', actor: name(a), outcome: 'allowed', message: `Budget check: ${name(a)} has ${before} of ${snap.limit} tokens left, enough for the call (about ${needed}).`, detail: budget });
    offset += a.latencyMs;
    push(offset, { layer: 'resource', step: 'provider-reply', actor: name(a), outcome: 'info', message: a.ok ? `${name(a)} replied HTTP ${a.status} after ${a.latencyMs} ms.` : `${name(a)} replied HTTP ${a.status} (${a.error}) after ${a.latencyMs} ms.`, detail: { position: a.position, status: a.status, latencyMs: a.latencyMs, error: a.error } });
    if (a.ok) push(offset, { layer: 'privilege', step: 'answer', actor: name(a), outcome: 'allowed', message: `Answered by ${name(a)}${a.position > 0 ? ' (a fallback)' : ''}; ${a.tokens} tokens charged to its own ledger.`, detail: { servedBy: name(a), position: a.position, tokensCharged: a.tokens } });
    else if (a.position < result.attempts.length - 1) push(offset, { layer: 'privilege', step: 'fallback', actor: name(a), outcome: 'info', message: `${name(a)} could not answer; the next model in the chain is tried.`, detail: { reason: a.reason } });
  }
  if (!result.ok) push(offset, { layer: 'privilege', step: 'refusal', actor: 'gateway', outcome: 'refused', message: `No model could answer (${result.refusal.code}): ${result.refusal.message}`, detail: { code: result.refusal.code } });
  return ev;
}

const WHY = {
  person: 'This lab has no signed-in person: the key belongs to an app.',
  authorize: 'This lab has no separate authorization decision: the key budget check is the only gate, shown under Privilege.',
  gateway: 'This lab has no agent gateway hop. The lab model of the LLM gateway is shown under Privilege.',
  agent: 'No call was made.', privilege: 'No call was made.', resource: 'No model provider was called in this run (every model was skipped before a call).',
};
const PRODUCT = { agent: 'lab mock app', privilege: 'lab mock LLM gateway', resource: 'lab mock model provider' };

export function mockLayers(events) {
  return LAYERS.map((layer) => ({
    layer, products: [], reason: WHY[layer],
    simulated: events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: PRODUCT[layer], outcome: e.outcome, message: e.message, detail: e.detail })),
  }));
}

// run: { id, startedAt (ISO), endedAt (ISO), events }.
export async function buildRunRecord(run, { clock = Date.now } = {}) {
  if (!run) return null;
  return createRunObservability({ clock }).collectRun({ runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: 'mock', layers: mockLayers(run.events) });
}

// Where a run leaves logs and where they could stream (rule 27: the README says the same). The lab reads no log and claims no product logged anything.
export const STREAMS = Object.freeze([
  { product: 'This lab (stdout)', lives: 'one line per decision on the lab\'s standard output (docker logs)', streams: 'a collector could ship it to a log index; this lab does not' },
  { product: 'The Privilege gateway', lives: 'not read by this lab (no Real mode yet)', streams: 'the Privilege SIEM export; whether the product logs a fallback is UNVERIFIED' },
]);
