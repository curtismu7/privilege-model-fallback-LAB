// Bounds and validation for everything a caller sends. Fixed messages, never an echo of the caller's text.
// The key has NO credential field: any field not listed here (apiKey, secret, token...) is refused as unknown.
import { PROVIDER_STATES, MAX_PROMPT_CHARS } from './model-gateway-sim/providerStub.js';
import { refuse } from './errors.js';

export const LIMITS = Object.freeze({
  maxChain: 5,
  maxBudgetTokens: 1_000_000,
  minTimeoutMs: 100,
  maxTimeoutMs: 60_000,
  defaultTimeoutMs: 3000,
  maxPromptChars: MAX_PROMPT_CHARS,
});

// Provider ids are the lab's own labels, not real vendors. The last one is a labelled STUB for a Bedrock assumed-role target
// (lab 4's evaluator does not exist yet); it behaves exactly like the other mock providers.
export const KNOWN_PROVIDERS = Object.freeze(['provider-a', 'provider-b', 'bedrock-assumed-role-stub']);

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function onlyKeys(obj, allowed, what) {
  if (!isPlain(obj)) throw refuse('bad_body', `${what} must be a JSON object`);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw refuse('unknown_field', `${what} has a field this lab does not accept`);
}

export function validateChain(chain) {
  if (!Array.isArray(chain)) throw refuse('bad_chain', 'chain must be a list of models');
  if (chain.length === 0) throw refuse('chain_empty', 'a key needs at least one model');
  if (chain.length > LIMITS.maxChain) throw refuse('chain_too_long', `a chain has at most ${LIMITS.maxChain} models`);
  const seen = new Set();
  return chain.map((e) => {
    onlyKeys(e, ['provider', 'model', 'budgetTokens'], 'a chain entry');
    if (typeof e.provider !== 'string' || !KNOWN_PROVIDERS.includes(e.provider)) throw refuse('unknown_provider', `provider must be one of: ${KNOWN_PROVIDERS.join(', ')}`);
    if (typeof e.model !== 'string' || !MODEL_ID.test(e.model)) throw refuse('bad_model', 'model must be 1 to 64 letters, digits, dots, dashes or underscores');
    if (!Number.isInteger(e.budgetTokens) || e.budgetTokens < 0 || e.budgetTokens > LIMITS.maxBudgetTokens) throw refuse('bad_budget', `budgetTokens must be a whole number from 0 to ${LIMITS.maxBudgetTokens}`);
    const id = `${e.provider}/${e.model}`;
    if (seen.has(id)) throw refuse('duplicate_model', 'the same provider and model appear twice in the chain');
    seen.add(id);
    return { provider: e.provider, model: e.model, budgetTokens: e.budgetTokens };
  });
}

export function validateTimeout(timeoutMs) {
  if (timeoutMs === undefined) return LIMITS.defaultTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < LIMITS.minTimeoutMs || timeoutMs > LIMITS.maxTimeoutMs) throw refuse('bad_timeout', `timeoutMs must be a whole number from ${LIMITS.minTimeoutMs} to ${LIMITS.maxTimeoutMs}`);
  return timeoutMs;
}

export function validateConfig(body) {
  onlyKeys(body, ['chain', 'timeoutMs'], 'the key config');
  return { chain: validateChain(body.chain), timeoutMs: validateTimeout(body.timeoutMs) };
}

export function validatePrompt(prompt) {
  if (typeof prompt !== 'string') throw refuse('bad_prompt', 'prompt must be a string');
  if (prompt.length > LIMITS.maxPromptChars) throw refuse('prompt_too_long', `prompt is over ${LIMITS.maxPromptChars} characters`);
  if (!prompt.trim()) throw refuse('empty_prompt', 'prompt must not be empty');
  return prompt;
}

// providerStates: one state per chain position (a model), not per provider. The lab's simplification, labelled in the spec.
export function validateProviderStates(states, chainLength) {
  if (states === undefined) return Array(chainLength).fill('healthy');
  if (!Array.isArray(states) || states.length > chainLength) throw refuse('bad_provider_states', 'providerStates must be a list with at most one state per model in the chain');
  for (const s of states) if (typeof s !== 'string' || !PROVIDER_STATES.includes(s)) throw refuse('unknown_provider_state', `a provider state must be one of: ${PROVIDER_STATES.join(', ')}`);
  return Array.from({ length: chainLength }, (_, i) => states[i] ?? 'healthy');
}
