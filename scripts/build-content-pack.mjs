// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERTICALS, DEFAULT_VERTICAL, fillDeep } from '../server/src/cast.js';
import { STORIES } from '../server/src/stories.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const cast = VERTICALS[DEFAULT_VERTICAL].cast;
  const stories = STORIES.map(({ file, ...s }) => ({ file, ...fillDeep(s, cast) }));
  const terms = {
    'primary-healthy': ['model-fallback'], 'primary-down': ['model-fallback'], 'primary-overloaded': ['model-fallback', 'unverified-model'], 'primary-out-of-budget': ['model-fallback', 'per-model-budget'],
    'fallback-different-provider': ['model-fallback'], 'both-budgets-exhausted': ['per-model-budget', 'named-refusal'], 'both-providers-down': ['named-refusal'], 'one-model-chain': ['named-refusal'], 'slow-primary-timeout': ['model-fallback'],
  };
  return {
    schema: 'demo-content-pack/1',
    id: 'privilege-model-fallback-lab',
    title: 'Privilege model fallback LAB',
    version,
    demo: { id: 'privilege-model-fallback-lab', name: 'Privilege model fallback LAB', catalog: 'D000', baseUrl: 'http://localhost:7836', doctor: '/api/health', tags: ['llm', 'fallback', 'budget', 'privilege', 'simulated', 'mock-only'] },
    glossary: [
      { id: 'model-fallback', term: 'Model fallback', definition: 'An LLM key names a second model that answers when the first is down, overloaded or out of budget. The fallback can be on a different provider. This is the only claim taken from the 2026-11-21 release notes; how a call is ordered, retried or named in the response is this lab\'s own model.', aliases: ['fallback model', 'second model'] },
      { id: 'per-model-budget', term: 'Per-model budget', definition: 'Each model on the key carries its own token budget, so a fallback answers within a known ceiling and its spend is charged to its own ledger, not the primary\'s.', aliases: ['fallback budget', 'token ledger'] },
      { id: 'named-refusal', term: 'Named refusal', definition: 'When no model can answer, the lab returns a result that names the refusal (all_budgets_exhausted, all_providers_failed, chain_exhausted or no_fallback_configured) and says which budgets ran out and which providers failed. The wording and status are the lab\'s own and UNVERIFIED.', aliases: ['refusal'] },
      { id: 'unverified-model', term: 'UNVERIFIED (lab model)', definition: 'Anything the release notes do not say is the lab\'s own model and is labelled UNVERIFIED: what overloaded means, whether a retry comes first, mid-stream failure, whether the guard re-runs on the fallback\'s answer, the response and refusal shape, token counting.', aliases: ['lab model'] },
    ],
    sources: [],
    cards: [
      ...stories.map((s) => ({ id: `try-${s.scenario}`, label: `${s.id}: ${s.title}`, description: s.control, group: 'try-it', action: { type: 'route', href: `/#fallback/${s.scenario}` }, terms: terms[s.scenario], story: s.id })),
      { id: 'concept-limits', label: 'What is sourced and what is the lab\'s model', description: 'The release-notes sentence, the lab\'s own model and the list of what is UNVERIFIED.', group: 'concept', action: { type: 'route', href: '/#limits' }, terms: ['unverified-model'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    diagrams: [{ id: 'model-fallback', label: 'LLM model fallback: a second model answers', href: '/#diagram', mode: 'mock' }],
    stories: stories.map((s) => ({ id: s.id, title: s.title, say: s.control, file: `server/src/data/stories/${s.file}` })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
