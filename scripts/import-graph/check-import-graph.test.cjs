/**
 * check-import-graph tests
 *
 * Covers the resolver (relative, alias, barrel, extensionless, `.js` → `.ts`),
 * import extraction (type-only, dynamic, comments/templates), direction
 * violations, cycle normalisation, and the baseline ratchet (new, rotated,
 * stale). Fixtures are in-memory so the tests never touch the real tree.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PACKAGES,
  buildGraph,
  directionViolations,
  normalizeCycle,
  findCycles,
  compareWithBaseline,
} = require('./check-import-graph.cjs');
const { extractImports, parseTsconfigAliases, resolveSpecifier } = require('./scan-imports.cjs');

const BACKEND_RULES = PACKAGES.find((p) => p.name === 'rapitas-backend').rules;
const FRONTEND_RULES = PACKAGES.find((p) => p.name === 'rapitas-frontend').rules;

/** Build a graph from an in-memory `{ path: source }` fixture. */
function graphOf(fixture, aliases = []) {
  return buildGraph(Object.keys(fixture), (f) => fixture[f], aliases);
}

test('resolver: relative, extensionless, barrel, .js→.ts, query suffix, packages', () => {
  const files = new Set(['src/a.ts', 'src/lib/index.ts', 'src/c.tsx', 'src/d.ts', 'src/e.css']);
  assert.equal(resolveSpecifier('src/x.ts', './a', files, []), 'src/a.ts');
  assert.equal(resolveSpecifier('src/x.ts', './lib', files, []), 'src/lib/index.ts');
  assert.equal(resolveSpecifier('src/x.ts', './lib/', files, []), 'src/lib/index.ts');
  assert.equal(resolveSpecifier('src/lib/y.ts', '..', files, []), null);
  assert.equal(resolveSpecifier('src/lib/y.ts', '../c', files, []), 'src/c.tsx');
  assert.equal(resolveSpecifier('src/x.ts', './d.js', files, []), 'src/d.ts');
  assert.equal(resolveSpecifier('src/x.ts', './a?restart=1', files, []), 'src/a.ts');
  assert.equal(resolveSpecifier('src/x.ts', './e.css', files, []), null);
  assert.equal(resolveSpecifier('src/x.ts', 'react', files, []), null);
  assert.equal(resolveSpecifier('src/x.ts', './missing', files, []), null);
});

test('resolver: tsconfig `@/` alias (with comments and trailing commas)', () => {
  const tsconfig = `{
    // comment
    "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
  }`;
  const aliases = parseTsconfigAliases(tsconfig, '');
  assert.deepEqual(aliases, [{ prefix: '@/', targets: ['src/'] }]);
  const files = new Set(['src/components/ui/Button.tsx', 'src/feature/tasks/index.ts']);
  assert.equal(
    resolveSpecifier('src/app/page.tsx', '@/components/ui/Button', files, aliases),
    'src/components/ui/Button.tsx',
  );
  assert.equal(
    resolveSpecifier('src/app/page.tsx', '@/feature/tasks', files, aliases),
    'src/feature/tasks/index.ts',
  );
});

test('extraction: import kinds, re-exports, and text that only looks like an import', () => {
  const src = [
    "import a from './a';",
    "import type { B } from './b';",
    "import { type C, type D } from './c';",
    "import { type E, F } from './e';",
    "export * from './g';",
    "export { h } from './h';",
    "export type { I } from './i';",
    "import './side-effect';",
    "const j = await import('./j');",
    "const k = require('./k');",
    "// import x from './commented';",
    "/* export * from './block-commented'; */",
    "const tpl = `import y from './in-template'`;",
    "const re = /from '.\\/in-regex'/;",
    'const s = "Don\'t";',
  ].join('\n');
  assert.deepEqual(extractImports(src), [
    { spec: './a', kind: 'static' },
    { spec: './b', kind: 'type' },
    { spec: './c', kind: 'type' },
    { spec: './e', kind: 'static' },
    { spec: './g', kind: 'static' },
    { spec: './h', kind: 'static' },
    { spec: './i', kind: 'type' },
    { spec: './side-effect', kind: 'static' },
    { spec: './j', kind: 'dynamic' },
    { spec: './k', kind: 'static' },
  ]);
});

test('extraction: an export without a semicolon does not swallow the next import', () => {
  const src = "export { a }\nimport type { B } from './b';\n";
  assert.deepEqual(extractImports(src), [{ spec: './b', kind: 'type' }]);
});

test('direction: services → routes is a violation; tests and other layers are not', () => {
  const g = graphOf({
    'services/s.ts': "import { r } from '../routes/r';",
    'services/s.test.ts': "import { r } from '../routes/r';",
    'services/lazy.ts': "export const f = () => import('../routes/r');",
    'routes/r.ts': "import { s } from '../services/s';",
    'utils/u.ts': "import type { R } from '../routes/r';",
    'config/c.ts': "import '../utils/u';",
  });
  assert.deepEqual(directionViolations('be', g.edges, BACKEND_RULES), [
    'services-must-not-import-routes: be/services/lazy.ts -> be/routes/r.ts',
    'services-must-not-import-routes: be/services/s.ts -> be/routes/r.ts',
    'utils-must-not-import-routes-or-services: be/utils/u.ts -> be/routes/r.ts',
  ]);
});

test('direction: frontend shared UI must not import features, lib/utils must not import app', () => {
  const aliases = [{ prefix: '@/', targets: ['src/'] }];
  const g = graphOf(
    {
      'src/components/ui/Button.tsx': "import { useTask } from '@/feature/tasks';",
      'src/components/ui/__tests__/Button.test.tsx': "import Page from '@/app/page';",
      'src/feature/tasks/index.ts': "import { Button } from '@/components/ui/Button';",
      'src/lib/api.ts': "import { x } from '../app/page';",
      'src/app/page.tsx': "import { Button } from '@/components/ui/Button';",
    },
    aliases,
  );
  assert.deepEqual(directionViolations('fe', g.edges, FRONTEND_RULES), [
    'lib-utils-must-not-import-app: fe/src/lib/api.ts -> fe/src/app/page.tsx',
    'ui-must-not-import-features: fe/src/components/ui/Button.tsx -> fe/src/feature/tasks/index.ts',
  ]);
});

test('cycles: normalised regardless of starting node', () => {
  const one = normalizeCycle(['b.ts', 'c.ts', 'a.ts']);
  const two = normalizeCycle(['a.ts', 'b.ts', 'c.ts']);
  assert.equal(one, 'a.ts -> b.ts -> c.ts -> a.ts');
  assert.equal(one, two);
});

test('cycles: runtime edges only — type-only and dynamic imports cannot close one', () => {
  const g = graphOf({
    'a.ts': "import { b } from './b';",
    'b.ts': "import { c } from './c';\nimport type { A } from './a';",
    'c.ts': "export * from './a';",
    'd.ts': "import { e } from './e';",
    'e.ts': "export const f = () => import('./d');",
  });
  assert.deepEqual(findCycles('p', g.nodes, g.edges), ['p/a.ts -> p/b.ts -> p/c.ts -> p/a.ts']);
});

test('cycles: every elementary cycle of a component is listed once', () => {
  const g = graphOf({
    'a.ts': "import './b';\nimport './c';",
    'b.ts': "import './a';",
    'c.ts': "import './b';",
  });
  assert.deepEqual(findCycles('p', g.nodes, g.edges), [
    'p/a.ts -> p/b.ts -> p/a.ts',
    'p/a.ts -> p/c.ts -> p/b.ts -> p/a.ts',
  ]);
});

test('baseline: a rotated baselined cycle passes, a new cycle fails, a gone entry is stale', () => {
  const g = graphOf({
    'x.ts': "import './y';",
    'y.ts': "import './x';",
    'n1.ts': "import './n2';",
    'n2.ts': "import './n1';",
  });
  const current = { direction: [], cycles: findCycles('p', g.nodes, g.edges) };
  const baseline = {
    direction: ['services-must-not-import-routes: p/services/old.ts -> p/routes/r.ts'],
    // Recorded starting from y.ts; must still match the x.ts-first form.
    cycles: ['p/y.ts -> p/x.ts -> p/y.ts'],
  };
  const diff = compareWithBaseline(current, baseline);
  assert.deepEqual(diff.added.cycles, ['p/n1.ts -> p/n2.ts -> p/n1.ts']);
  assert.deepEqual(diff.added.direction, []);
  assert.deepEqual(diff.stale.cycles, []);
  assert.deepEqual(diff.stale.direction, baseline.direction);
});

test('baseline: identical findings produce no diff', () => {
  const current = { direction: ['r: a -> b'], cycles: ['a -> b -> a'] };
  const diff = compareWithBaseline(current, { direction: ['r: a -> b'], cycles: ['a -> b -> a'] });
  assert.deepEqual(diff, {
    added: { direction: [], cycles: [] },
    stale: { direction: [], cycles: [] },
  });
});

test('graph skips node_modules, generated code and declaration files', () => {
  const g = graphOf({
    'a.ts': "import './generated/prisma/index';\nimport './types';",
    'generated/prisma/index.ts': "import '../../a';",
    'node_modules/x/index.js': "require('../../a');",
    'types.d.ts': '',
  });
  assert.deepEqual(g.nodes, ['a.ts']);
  assert.deepEqual(g.edges, []);
});
