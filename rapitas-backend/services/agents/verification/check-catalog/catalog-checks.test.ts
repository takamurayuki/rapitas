/**
 * catalog-checks — the CI / pre-save parity runners on a real git repository
 * (task 1602)
 *
 * Each runner must fail on a violation THIS diff introduces and pass when the
 * only violation already existed in the base, so the post-commit gate never
 * blocks a task on someone else's debt.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  attributionCheck,
  docsDriftCheck,
  importGraphCheck,
  runCatalogChecks,
  secretCheck,
  todosCheck,
} from './catalog-checks';
import {
  fakeGithubToken,
  makeCatalogRepo,
  tagLines,
  type CatalogRepo,
} from './catalog-repo.fixture';

let repo: CatalogRepo | null = null;
afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe('import-graph', () => {
  test('a new services → routes import in the diff fails and names the file', async () => {
    repo = makeCatalogRepo();
    repo.write(
      'rapitas-backend/services/a.ts',
      "import { b } from '../routes/b';\nexport const a = b;\n",
    );
    const check = await importGraphCheck(repo.dir, ['rapitas-backend/services/a.ts']);
    expect(check.name).toBe('import-graph');
    expect(check.ran).toBe(true);
    expect(check.ok).toBe(false);
    expect(check.errorCount).toBe(1);
    expect(check.failureFiles).toEqual(['rapitas-backend/services/a.ts']);
  });

  test('a violation that only exists in the base does not fail the diff', async () => {
    repo = makeCatalogRepo({
      'rapitas-backend/services/old.ts': "import { b } from '../routes/b';\nexport const o = b;\n",
    });
    repo.write('rapitas-backend/services/c.ts', 'export const c = 1;\n');
    const check = await importGraphCheck(repo.dir, ['rapitas-backend/services/c.ts']);
    expect(check.ran).toBe(true);
    expect(check.ok).toBe(true);
    expect(check.details).toContain('既存');
  });

  test('no script means not run', async () => {
    repo = makeCatalogRepo({}, { withScripts: false });
    const check = await importGraphCheck(repo.dir, ['rapitas-backend/services/c.ts']);
    expect(check).toMatchObject({ ran: false, ok: true });
  });
});

describe('docs-drift', () => {
  test('an untracked file reading an env var missing from .env.example fails', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/services/new.ts', 'export const v = process.env.FOO_BAR;\n');
    const check = await docsDriftCheck(repo.dir, ['rapitas-backend/services/new.ts']);
    expect(check.ok).toBe(false);
    expect(check.errorCount).toBe(1);
    expect(check.details).toContain('FOO_BAR');
    expect(check.failureFiles).toEqual(['rapitas-backend/services/new.ts']);
  });

  test('documenting the variable in the same diff passes', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/services/new.ts', 'export const v = process.env.FOO_BAR;\n');
    repo.write('rapitas-backend/.env.example', 'KNOWN_VAR=1\nFOO_BAR=\n');
    const changed = ['rapitas-backend/services/new.ts', 'rapitas-backend/.env.example'];
    const check = await docsDriftCheck(repo.dir, changed);
    expect(check).toMatchObject({ ran: true, ok: true, errorCount: 0 });
  });

  test('an undocumented read in an untouched base file does not fail the diff', async () => {
    repo = makeCatalogRepo({
      'rapitas-backend/services/legacy.ts': 'export const v = process.env.LEGACY_VAR;\n',
    });
    repo.write('rapitas-backend/services/c.ts', 'export const c = 1;\n');
    const check = await docsDriftCheck(repo.dir, ['rapitas-backend/services/c.ts']);
    expect(check).toMatchObject({ ran: true, ok: true });
  });
});

describe('todos', () => {
  test('a HACK added past the ceiling fails', async () => {
    repo = makeCatalogRepo({ 'rapitas-backend/old.ts': tagLines('HACK', 14) });
    repo.write('rapitas-backend/new.ts', tagLines('HACK', 1));
    const check = await todosCheck(repo.dir, ['rapitas-backend/new.ts']);
    expect(check.ok).toBe(false);
    expect(check.failureFiles).toEqual(['rapitas-backend/new.ts']);
  });

  test('an over-ceiling count that the diff did not add passes with a note', async () => {
    repo = makeCatalogRepo({ 'rapitas-backend/old.ts': tagLines('HACK', 15) });
    repo.write('rapitas-backend/c.ts', 'export const c = 1;\n');
    const check = await todosCheck(repo.dir, ['rapitas-backend/c.ts']);
    expect(check).toMatchObject({ ran: true, ok: true });
    expect(check.details).toContain('既存');
  });
});

describe('secret dry-run', () => {
  test('a token-shaped string fails, and nothing is staged or committed', async () => {
    repo = makeCatalogRepo();
    const head = repo.git('rev-parse', 'HEAD').trim();
    repo.write('rapitas-backend/conf.ts', `export const t = '${fakeGithubToken()}';\n`);
    const check = await secretCheck(repo.dir, ['rapitas-backend/conf.ts']);
    expect(check).toMatchObject({ name: 'secret', ran: true, ok: false, errorCount: 1 });
    expect(check.failureFiles).toEqual(['rapitas-backend/conf.ts']);
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(head);
    expect(repo.git('diff', '--cached', '--name-only').trim()).toBe('');
  });

  test('ordinary code passes', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/conf.ts', "export const t = 'hello';\n");
    expect((await secretCheck(repo.dir, ['rapitas-backend/conf.ts'])).ok).toBe(true);
  });
});

describe('attribution and the combined runner', () => {
  test('without a task id attribution is advisory and not run', async () => {
    repo = makeCatalogRepo();
    const check = await attributionCheck(repo.dir, ['x.ts'], undefined);
    expect(check).toMatchObject({ name: 'attribution', ran: false, ok: true, advisory: true });
  });

  test('runCatalogChecks reports all five checks by name', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/services/c.ts', 'export const c = 1;\n');
    const checks = await runCatalogChecks(repo.dir, ['rapitas-backend/services/c.ts']);
    expect(checks.map((c) => c.name)).toEqual([
      'import-graph',
      'docs-drift',
      'todos',
      'secret',
      'attribution',
    ]);
    expect(checks.filter((c) => c.name !== 'attribution').every((c) => c.ok)).toBe(true);
  });
});

describe('attribution failure', () => {
  test('an unreadable session table skips attribution instead of throwing', async () => {
    const { mock } = await import('bun:test');
    mock.module('./presave-scan', () => ({
      scanForSecrets: async () => [],
      attributeWorkingTree: async () => {
        throw new Error('db down');
      },
    }));
    const { attributionCheck: fresh } = await import(`./catalog-checks?attr-fail`);
    const check = await fresh('/nowhere', ['a.ts'], 7);
    expect(check).toMatchObject({ name: 'attribution', ran: false, ok: true, advisory: true });
  });
});
