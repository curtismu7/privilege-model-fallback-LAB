// The diagram is diagram-studio/1 DATA (server/diagrams/model-fallback.json), loaded BY NAME and checked with the studio's own validator copy
// (diagramStudioValidate.js). Nothing here builds a node or an edge by hand: the page draws exactly the boxes and arrows the file lists.
// The file is a byte copy of MODEL_FALLBACK_FLOW from diagram-studio-LAB (see server/diagrams/diagrams.sha256 for the source commit).
// Each step walks its arrows in order; the page's Simulate steps through them one arrow at a time.
import fs from 'node:fs';
import { fillDeep } from './cast.js';
import { validateDiagram } from './diagramStudioValidate.js';

// (HERE is a variable on purpose: Vite rewrites a literal `new URL('./x', import.meta.url)` into an asset URL, which would break the web tests that load this module.)
const HERE = import.meta.url;
const DIR = new URL('../diagrams/', HERE);
export const DIAGRAM_NAMES = Object.freeze(['model-fallback']);
export const diagramProblems = (doc) => validateDiagram(doc);

function load(name) {
  const doc = JSON.parse(fs.readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
  const problems = diagramProblems(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}
const DOCS = Object.freeze(Object.fromEntries(DIAGRAM_NAMES.map((n) => [n, load(n)])));
export const rawDiagram = (name) => (typeof name === 'string' && Object.hasOwn(DOCS, name) ? DOCS[name] : null);
export const hasDiagram = (name) => rawDiagram(name) !== null;

// The shape the page reads: { name, title, intro, nodes: [{id, label, kind, x, y}], steps: [{from, to, label, title, say}] } (one step per arrow).
export function buildDiagram(cast, name) {
  const d = fillDeep(DOCS[name], cast);
  return {
    name: d.id,
    title: d.title,
    intro: d.lede,
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.group, x: n.x, y: n.y })),
    steps: d.steps.flatMap((s) => s.edges.map((i) => {
      const e = d.edges[i];
      // The data numbers its labels itself ("3b first model down..."); the page numbers the arrows in walk order, so the data's own number is dropped here.
      return { from: e.source, to: e.target, label: (e.label || s.title).replace(/^\d+[a-z]?\s+/, ''), title: s.title, say: [s.what, s.why].filter(Boolean).join(' ') };
    })),
  };
}
