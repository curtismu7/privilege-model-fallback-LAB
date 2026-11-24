import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.deepEqual(ports, ['127.0.0.1:${HOST_PORT:-7836}:7836']);
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7836:7836"', '- "0.0.0.0:7836:7836"', '- 7836', '- "::1:7836:7836"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose default host port and Dockerfile port are allowed ports and agree (7836, provisional)', () => {
  const compose = here('docker-compose.yml');
  const host = Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]);
  assert.equal(host, 7836);
  assert.equal(portProblem(host), null);
  const docker = here('Dockerfile');
  const port = Number(/^EXPOSE (\d+)/m.exec(docker)[1]);
  assert.equal(port, 7836);
  assert.equal(portProblem(port), null);
  assert.match(compose, new RegExp(`:${port}"`));
  assert.match(compose, /PORT: "7836"/);
  assert.match(docker, /^ENV PMF_BIND=0\.0\.0\.0$/m);
});

test('the container is non-root and locked down: USER node, read-only fs, no capabilities, no new privileges', () => {
  const compose = here('docker-compose.yml');
  assert.match(here('Dockerfile'), /^USER node$/m);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
});

test('the long-running service restarts unless stopped (rule 21) and has a healthcheck on /api/health', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /^\s+restart: unless-stopped$/m);
  const hc = /healthcheck:[\s\S]*?test: \[(.*)\]/.exec(compose);
  assert.ok(hc, 'a healthcheck is defined');
  assert.match(hc[1], /127\.0\.0\.1:7836\/api\/health/);
  assert.match(hc[1], /demo-health\/1/);
});

test('the image builds the web app, serves web/dist, ships the diagram data and the talk track, and installs no dev dependency at run time', () => {
  const docker = here('Dockerfile');
  assert.match(docker, /npm run build -w web/);
  assert.match(docker, /COPY --from=build \/app\/web\/dist web\/dist/);
  assert.match(docker, /COPY server\/diagrams server\/diagrams/);
  assert.match(docker, /COPY docs\/talk-track\.md docs\/talk-track\.md/);
  assert.match(docker, /npm ci --omit=dev -w server/);
  assert.match(docker, /^FROM node:26-alpine/m);
});

test('compose never mounts the Docker socket and passes no log-reader settings', () => {
  const compose = here('docker-compose.yml');
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.doesNotMatch(compose, /RUN_OBS_/);
});

// ---- the build context: a COPY of a file .dockerignore excludes fails the image build ("not found"), and only a real build used to show it ----
// A small .dockerignore matcher (last matching pattern wins, `!` re-includes, `*` stays inside one path segment, `**` crosses them, a pattern that
// matches a parent directory excludes everything under it). No dependency.
const globToRegex = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')}$`);
export function ignored(file, dockerignore) {
  const parts = file.split('/');
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/')); // the file and each parent directory
  let out = false;
  for (const raw of dockerignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    const neg = raw.startsWith('!');
    const re = globToRegex(neg ? raw.slice(1) : raw);
    if (prefixes.some((p) => re.test(p))) out = !neg;
  }
  return out;
}
// The sources of every COPY that reads the build context (not `--from=<stage>`), with line continuations joined.
export function contextCopies(dockerfile) {
  return dockerfile.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => /^COPY\s/i.test(l) && !/--from=/i.test(l))
    .flatMap((l) => l.split(/\s+/).slice(1).filter((t) => !t.startsWith('--')).slice(0, -1));
}

test('the matcher: last pattern wins, a negation re-includes, a parent directory excludes what is under it', () => {
  assert.equal(ignored('docs/talk-track.md', 'docs'), true, 'excluding the directory excludes its files');
  assert.equal(ignored('docs/talk-track.md', 'docs/*'), true);
  assert.equal(ignored('docs/talk-track.md', 'docs/*\n!docs/talk-track.md'), false);
  assert.equal(ignored('docs/spec.md', 'docs/*\n!docs/talk-track.md'), true);
  assert.equal(ignored('web/dist/index.html', '**/dist'), true);
  assert.equal(ignored('server/src/app.js', '**/node_modules\n**/dist'), false);
  assert.equal(ignored('a/b/c.js', '*.js'), false, '* does not cross a directory');
  assert.equal(ignored('c.js', '# comment\n*.js'), true);
});

test('every COPY from the build context names a file or folder .dockerignore lets through (the image builds)', () => {
  const dockerignore = here('.dockerignore');
  const sources = contextCopies(here('Dockerfile'));
  assert.ok(sources.includes('docs/talk-track.md') && sources.includes('server/src') && sources.length >= 6, `the parser found the COPY sources: ${sources.join(', ')}`);
  for (const s of sources) {
    if (s === '.') continue; // the whole context: nothing of its own to exclude
    assert.equal(ignored(s.replace(/\/$/, ''), dockerignore), false, `COPY ${s} reads a path .dockerignore excludes: the build fails with "not found". Re-include it with a "!" line.`);
    assert.ok(fs.existsSync(new URL(`../${s}`, import.meta.url)), `COPY ${s}: the path does not exist in the repo`);
  }
});

test('the checker would have caught the build failure: the same Dockerfile against a .dockerignore that excludes docs', () => {
  const broken = here('.dockerignore').replace('!docs/talk-track.md\n', '');
  assert.ok(contextCopies(here('Dockerfile')).some((s) => ignored(s, broken)), 'COPY docs/talk-track.md is flagged once the re-include line is gone');
  assert.equal(ignored('docs/talk-track.md', 'docs'), true);
});

test('customer.config.json is optional and read-only when mounted: the compose file documents the mount and passes CUSTOMER_CONFIG (rule 12)', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /CUSTOMER_CONFIG: \$\{CUSTOMER_CONFIG:-\}/);
  assert.match(compose, /#\s+- \.\/customer\.config\.json:\/config\/customer\.config\.json:ro/, 'the optional mount is read-only');
  assert.match(here('README.md'), /CUSTOMER_CONFIG=\/config\/customer\.config\.json/);
});
