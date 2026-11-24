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
