/**
 * automated-verifier — the catalog checks run inside the self-verifier (task 1602)
 *
 * Before task 1602 the self-verifier passed a diff that CI's import-graph or
 * docs-drift step then failed (task 1585). These run the real verifier on a
 * temporary repository: the five catalog checks must be reported, and a new
 * import-graph violation or an undocumented env var must turn the verdict red.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runAutomatedVerification } from './automated-verifier';
import { makeCatalogRepo, type CatalogRepo } from './check-catalog/catalog-repo.fixture';

// Each run spawns the three repo scripts; the whole verifier needs more than 5 s.
setDefaultTimeout(120_000);

let repo: CatalogRepo | null = null;
afterEach(() => {
  repo?.cleanup();
  repo = null;
});

const names = ['import-graph', 'docs-drift', 'todos', 'secret', 'attribution'];

describe('runAutomatedVerification with the catalog checks', () => {
  test('a clean diff reports every catalog check and passes', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/services/c.ts', 'export const c = 1;\n');
    const result = await runAutomatedVerification(repo.dir);
    for (const n of names) expect(result.checks.map((c) => c.name)).toContain(n);
    expect(result.ok).toBe(true);
  });

  test('a new services → routes import fails the run and says how to fix it', async () => {
    repo = makeCatalogRepo();
    repo.write(
      'rapitas-backend/services/a.ts',
      "import { b } from '../routes/b';\nexport const a = b;\n",
    );
    const result = await runAutomatedVerification(repo.dir);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('import-graph=NG(1)');
    const check = result.checks.find((c) => c.name === 'import-graph')!;
    expect(check.failureFiles).toEqual(['rapitas-backend/services/a.ts']);
    expect(check.gateMessage).toContain('Import direction and cycles');
    expect(check.fixHint).toBeTruthy();
  });

  test('an env var missing from .env.example fails the run', async () => {
    repo = makeCatalogRepo();
    repo.write('rapitas-backend/services/new.ts', 'export const v = process.env.FOO_BAR;\n');
    const result = await runAutomatedVerification(repo.dir);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('docs-drift=NG(1)');
  });

  test('an advisory failure is reported but does not fail the run', async () => {
    const { computeOverallOk } = await import('./automated-verifier');
    expect(
      computeOverallOk([
        { name: 'lint', ran: true, ok: true, errorCount: 0, details: '' },
        { name: 'attribution', ran: true, ok: false, errorCount: 1, details: '', advisory: true },
      ]),
    ).toBe(true);
  });
});
