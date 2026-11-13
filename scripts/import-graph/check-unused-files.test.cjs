/**
 * check-unused-files tests
 *
 * Covers reachability (imports, string-path literals, reference files, entry
 * rules, explicit roots), the exemptions (pure barrels, generated files), the
 * test-only report, cross-package references, and the baseline ratchet.
 * Fixtures are in-memory so the tests never touch the real tree.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PACKAGES,
  isTestFile,
  isExempt,
  resolvePathToken,
  findUnused,
  compareWithBaseline,
  externalRefsFor,
} = require('./check-unused-files.cjs');

const BACKEND = PACKAGES.find((p) => p.name === 'rapitas-backend');
const FRONTEND = PACKAGES.find((p) => p.name === 'rapitas-frontend');

/** Run findUnused over an in-memory `{ path: source }` fixture. */
function unusedOf(pkg, fixture, { aliases = [], external = [], extraRoots = new Set() } = {}) {
  return findUnused(pkg, Object.keys(fixture), (f) => fixture[f], aliases, external, extraRoots);
}

test('an unreferenced file is reported; an imported one is not', () => {
  const r = unusedOf(BACKEND, {
    'index.ts': "import { a } from './services/used';\n",
    'services/used.ts': 'export const a = 1;\n',
    'services/orphan.ts': 'export const b = 2;\n',
  });
  assert.deepEqual(r.unused, ['rapitas-backend/services/orphan.ts']);
});

test('reachability is transitive and follows type-only, dynamic and require edges', () => {
  const r = unusedOf(BACKEND, {
    'index.ts': "await import('./server-main');\n",
    'server-main.ts': "import type { T } from './types/t';\nconst x = require('./lib/x.cjs');\n",
    'types/t.ts': 'export type T = 1;\n',
    'lib/x.cjs': "module.exports = require('./y.cjs');\n",
    'lib/y.cjs': 'module.exports = 1;\n',
    'lib/z.cjs': 'module.exports = 2;\n',
  });
  assert.deepEqual(r.unused, ['rapitas-backend/lib/z.cjs']);
});

test('a string literal naming a file is an edge (Worker URL, join segments, templates)', () => {
  const r = unusedOf(BACKEND, {
    'index.ts': [
      "new Worker(new URL('./workers/parser.ts', import.meta.url).href);",
      "const p = join(process.cwd(), 'workers', 'agent-worker.ts');",
      'const q = `${root}/workers/daemon.mjs`;',
    ].join('\n'),
    'workers/parser.ts': '',
    'workers/agent-worker.ts': '',
    'workers/daemon.mjs': '',
    'workers/stale.cjs': '',
  });
  assert.deepEqual(r.unused, ['rapitas-backend/workers/stale.cjs']);
});

test('a file named only in a comment stays unreachable', () => {
  const r = unusedOf(BACKEND, {
    'index.ts': '// the old worker was workers/old.cjs\n/* see workers/old.cjs */\n',
    'workers/old.cjs': '',
  });
  assert.deepEqual(r.unused, ['rapitas-backend/workers/old.cjs']);
});

test('in-package reference files (package.json, bunfig.toml, gate lists) make roots', () => {
  const r = unusedOf(BACKEND, {
    'package.json': JSON.stringify({ scripts: { dev: 'bun run scripts/dev.ts' } }),
    'bunfig.toml': 'preload = ["./setup/preload.ts"]\n',
    'scripts/dev.ts': '',
    'setup/preload.ts': '',
    'scripts/forgotten.ts': '',
  });
  assert.deepEqual(r.unused, ['rapitas-backend/scripts/forgotten.ts']);
});

test('extra roots (scripts a doc tells a human to run) are honoured', () => {
  const fixture = { 'scripts/manual-probe.ts': "import './helper';\n", 'scripts/helper.ts': '' };
  assert.equal(unusedOf(BACKEND, fixture).unused.length, 2);
  const r = unusedOf(BACKEND, fixture, { extraRoots: new Set(['scripts/manual-probe.ts']) });
  assert.deepEqual(r.unused, []);
});

test('tests and test helpers are roots and never reported', () => {
  const r = unusedOf(BACKEND, {
    'services/a.test.ts': "import { h } from '../tests/helpers/h';\nimport { a } from './a';\n",
    'services/a.ts': 'export const a = 1;\n',
    'tests/helpers/h.ts': 'export const h = 1;\n',
    'services/mock-thing.ts': '',
  });
  assert.deepEqual(r.unused, []);
  assert.ok(isTestFile('src/__tests__/x.tsx'));
  assert.ok(isTestFile('services/execution-manager.test-helpers.ts'));
  assert.ok(!isTestFile('services/attestation.ts'));
});

test('files only tests reach are listed as test-only, not as unused', () => {
  const r = unusedOf(BACKEND, {
    'index.ts': "import './services/live';\n",
    'services/live.ts': '',
    'services/dead.ts': 'export const d = 1;\n',
    'services/dead.test.ts': "import { d } from './dead';\n",
  });
  assert.deepEqual(r.unused, []);
  assert.deepEqual(r.testOnly, ['rapitas-backend/services/dead.ts']);
});

test('frontend: Next.js app router files, configs and the @/ alias', () => {
  const aliases = [{ prefix: '@/', targets: ['src/'] }];
  const r = unusedOf(
    FRONTEND,
    {
      'src/app/tasks/[id]/page.tsx': "import X from '@/components/X';\n",
      'src/app/(group)/not-found.tsx': '',
      'src/app/api/health/route.ts': '',
      'src/middleware.ts': '',
      'src/components/X.tsx': '',
      'src/components/Y.tsx': '',
      'vitest.config.ts': "export default { test: { setupFiles: ['./src/test/setup.ts'] } };\n",
      'src/test/setup.ts': '',
      'scripts/outside-scope.mjs': '',
    },
    { aliases },
  );
  // scripts/ is outside the frontend scope: in the graph, never reported.
  assert.deepEqual(r.unused, ['rapitas-frontend/src/components/Y.tsx']);
});

test('pure barrels and generated files are exempt but do not make anything reachable', () => {
  const r = unusedOf(BACKEND, {
    'services/x/index.ts': "export * from './a';\nexport { b } from './b';\n",
    'services/x/a.ts': '',
    'services/x/b.ts': '',
    'services/x/a.guards.generated.ts': "import './a';\n",
    'services/y/index.ts': 'export function notABarrel() {}\n',
  });
  assert.deepEqual(r.unused, [
    'rapitas-backend/services/x/a.ts',
    'rapitas-backend/services/x/b.ts',
    'rapitas-backend/services/y/index.ts',
  ]);
  assert.ok(isExempt('a/index.ts', "'use client';\nexport { A } from './A';\n"));
  assert.ok(isExempt('a/index.ts', 'export {};\n'));
  assert.ok(!isExempt('a/index.ts', "export { A } from './A';\nexport const B = 1;\n"));
});

test('explicit roots cover runtime loads by computed path', () => {
  const pkg = { ...BACKEND, explicit: { 'plugins/dyn.ts': 'loaded by a computed path' } };
  assert.deepEqual(unusedOf(pkg, { 'plugins/dyn.ts': '' }).unused, []);
});

test('external references: repo-level workflows and cross-package imports', () => {
  const texts = [
    { source: '.github/workflows/ci.yml', text: 'run: bun scripts/gate.ts\n', pkg: null },
    {
      source: '.github/workflows/b.yml',
      text: 'run: node rapitas-backend/scripts/b.cjs\n',
      pkg: null,
    },
    {
      source: 'rapitas-frontend/eslint.config.mjs',
      text: "import r from '../rapitas-backend/eslint-rules/rule.mjs';\n",
      pkg: 'rapitas-frontend',
    },
    // A frontend file naming `scripts/x.ts` is NOT a backend reference.
    {
      source: 'rapitas-frontend/src/a.ts',
      text: "'scripts/frontend-only.ts'",
      pkg: 'rapitas-frontend',
    },
  ];
  const external = externalRefsFor('rapitas-backend', texts);
  const r = unusedOf(
    BACKEND,
    {
      'scripts/gate.ts': '',
      'scripts/b.cjs': '',
      'eslint-rules/rule.mjs': '',
      'scripts/frontend-only.ts': '',
    },
    { external },
  );
  assert.deepEqual(r.unused, ['rapitas-backend/scripts/frontend-only.ts']);
});

test('resolvePathToken: bare names match by basename except index', () => {
  const files = new Set(['workers/w.ts', 'a/index.ts']);
  const byBase = new Map([
    ['w.ts', ['workers/w.ts']],
    ['index.ts', ['a/index.ts']],
  ]);
  assert.deepEqual(resolvePathToken('w.ts', [''], files, byBase), ['workers/w.ts']);
  assert.deepEqual(resolvePathToken('index.ts', [''], files, byBase), []);
  assert.deepEqual(resolvePathToken('../workers/w.ts', ['lib'], files, byBase), ['workers/w.ts']);
});

test('baseline ratchet: new entries and stale entries both surface', () => {
  const diff = compareWithBaseline(['a.ts', 'new.ts'], ['a.ts', 'gone.ts']);
  assert.deepEqual(diff.added, ['new.ts']);
  assert.deepEqual(diff.stale, ['gone.ts']);
  assert.deepEqual(compareWithBaseline(['a.ts'], ['a.ts']), { added: [], stale: [] });
});
