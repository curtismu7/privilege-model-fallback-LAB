// Text the page and the API show. The banner is the one honesty text: what is simulated, and that anything beyond the release notes is UNVERIFIED.
export const LAB_ID = 'privilege-model-fallback-lab';
export const LAB_NAME = 'Privilege model fallback LAB';
export const RELEASE_NOTES_DATE = '2026-11-21';

export const BANNER = `SIMULATED. This lab runs a mock LLM key, mock model providers and a lab clock; nothing leaves this machine. `
  + `Only this is taken from the ${RELEASE_NOTES_DATE} release notes: an LLM key can name a second model, even on another provider, that answers when the first is down, overloaded or out of budget, and the fallback carries its own budget. `
  + `Every other behaviour shown here (what overloaded means, status codes, latencies, whether a retry comes first, what happens mid-stream, whether the guard re-runs on the fallback's answer, the refusal's wording) is this lab's own model and is UNVERIFIED against the product.`;

export const UNVERIFIED = Object.freeze([
  'what "overloaded" means (the lab uses a provider-origin 429)',
  'whether a retry comes before the fallback (the lab does not retry)',
  'behaviour when a model fails mid-stream (streaming is not modelled)',
  'whether the guard runs again on the fallback\'s answer',
  'how the response names the model that served it',
  'the refusal wording and status when no model can answer',
  'token counting (the lab charges input words plus a fixed 120-token reply)',
]);

export const REAL_UNAVAILABLE = 'Real mode is not built yet. It needs a tenant running the 2026-11-21 release and is owner-run and read-only; it comes after Mock.';

// The Limits page: exactly what the release notes say, what is this lab's own model, and what is not claimed. The one place these are written.
export const SOURCED = Object.freeze([
  `An LLM key can name a second model that answers when the first is down, overloaded or out of budget (${RELEASE_NOTES_DATE} release notes).`,
  'The fallback can be a different provider.',
  'The fallback carries its own budget.',
]);

export const LAB_MODEL = Object.freeze([
  'A key has an ordered chain of 1 to 5 models. Each has its own token ledger and its own mock provider, on one lab clock.',
  'A call tries the chain in order and the first model that answers wins.',
  'A model is skipped, with no provider call, when its remaining budget cannot cover the call (the lab counts input words plus 120 reply tokens).',
  'A model that fails (down 503, overloaded 429, timeout 504, all provider failures) is skipped. There is no retry before the fallback.',
  'Only the serving model is charged, on its own ledger. A ledger never overdraws and a zero budget is out of budget at once.',
  'If no model answers, the result is a named refusal: all_budgets_exhausted, all_providers_failed, chain_exhausted (a mix) or no_fallback_configured (a one-model chain). It is returned as a normal result with ok false.',
  'Provider state is set per model in the chain, not per provider.',
  'The Bedrock assumed-role target is a labelled stub provider until the assume-role lab\'s evaluator exists.',
]);

export const NOT_CLAIMED = Object.freeze([
  'Whether a gateway\'s own rate-limit refusal can trigger a fallback. This is an open question and the lab shows no opinion on it (owner decision 2026-11-24).',
]);
