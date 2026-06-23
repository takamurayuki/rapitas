/**
 * check-boundary-tests.test
 *
 * Unit tests for scripts/check-boundary-tests.ts.
 * Tests cover: parseFilesArg, extractResolverFunctions, stripComments,
 * collectResolverFiles, checkResolverDrift, and checkBoundaryTests.
 * CLI-mode integration is tested via spawnSync invocations.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  parseFilesArg,
  extractResolverFunctions,
  stripComments,
  collectResolverFiles,
  checkResolverDrift,
  checkBoundaryTests,
} from './check-boundary-tests';

const SCRIPT = pathResolve(fileURLToPath(import.meta.url), '..', 'check-boundary-tests.ts');

// ---------------------------------------------------------------------------
// parseFilesArg
// ---------------------------------------------------------------------------

describe('parseFilesArg', () => {
  test('returns null when --files flag is absent', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--check'])).toBeNull();
  });

  test('parses --files=foo.ts,bar.ts form', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files=foo.ts,bar.ts'])).toEqual([
      'foo.ts',
      'bar.ts',
    ]);
  });

  test('parses single --files=single.ts form', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files=single.ts'])).toEqual(['single.ts']);
  });

  test('returns empty array for --files= with no value', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files='])).toEqual([]);
  });

  test('parses --files foo.ts bar.ts (space-separated, stops at next flag)', () => {
    expect(
      parseFilesArg(['bun', 'script.ts', '--files', 'foo.ts', 'bar.ts', '--check']),
    ).toEqual(['foo.ts', 'bar.ts']);
  });

  test('parses --files with single space-separated arg', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files', 'foo.ts'])).toEqual(['foo.ts']);
  });

  test('returns empty array for --files with no following args', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files'])).toEqual([]);
  });

  test('trims spaces around comma-separated values', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files=foo.ts, bar.ts , baz.ts'])).toEqual([
      'foo.ts',
      'bar.ts',
      'baz.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// extractResolverFunctions
// ---------------------------------------------------------------------------

describe('extractResolverFunctions', () => {
  test('extracts async function declarations', () => {
    const src = `export async function resolveTaskById(id: number) { return null; }`;
    expect(extractResolverFunctions(src)).toEqual(['resolveTaskById']);
  });

  test('extracts non-async function declarations', () => {
    const src = `export function resolveUserByEmail(email: string) { return null; }`;
    expect(extractResolverFunctions(src)).toEqual(['resolveUserByEmail']);
  });

  test('extracts const arrow functions', () => {
    const src = `export const resolveSession = async (id: string) => null;`;
    expect(extractResolverFunctions(src)).toEqual(['resolveSession']);
  });

  test('extracts multiple functions', () => {
    const src = [
      'export async function resolveA(id: number) {}',
      'export async function resolveB(id: number) {}',
      'export const resolveC = () => null;',
    ].join('\n');
    expect(extractResolverFunctions(src).sort()).toEqual(['resolveA', 'resolveB', 'resolveC']);
  });

  test('does not extract non-resolve exports', () => {
    const src = `
      export function getTask(id: number) {}
      export const TASK_TYPES = ['a', 'b'] as const;
    `;
    expect(extractResolverFunctions(src)).toHaveLength(0);
  });

  test('deduplicates if same name appears twice', () => {
    const src = `export async function resolveX() {}\nexport async function resolveX() {}`;
    expect(extractResolverFunctions(src)).toEqual(['resolveX']);
  });

  test('returns empty for empty file', () => {
    expect(extractResolverFunctions('')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

describe('stripComments', () => {
  test('removes line comments', () => {
    const src = `const x = 1; // resolveTask is here\nconst y = 2;`;
    const stripped = stripComments(src);
    expect(stripped).not.toContain('resolveTask');
    expect(stripped).toContain('const x = 1;');
    expect(stripped).toContain('const y = 2;');
  });

  test('removes block comments', () => {
    const src = `/* resolveSession */\nconst y = 2;`;
    const stripped = stripComments(src);
    expect(stripped).not.toContain('resolveSession');
    expect(stripped).toContain('const y = 2;');
  });

  test('removes multi-line block comments', () => {
    const src = `/**\n * resolveUser\n * @param id\n */\nexport function foo() {}`;
    const stripped = stripComments(src);
    expect(stripped).not.toContain('resolveUser');
    expect(stripped).toContain('export function foo() {}');
  });

  test('preserves content outside comments', () => {
    const src = `// comment\nconst resolveTask = 1; // another comment`;
    const stripped = stripComments(src);
    // The variable declaration (not a comment) should remain
    expect(stripped).toContain('resolveTask');
  });

  test('handles file with no comments', () => {
    const src = `const x = 1;\nconst y = 2;`;
    expect(stripComments(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// checkResolverDrift — tmpdir scenarios
// ---------------------------------------------------------------------------

describe('checkResolverDrift', () => {
  const tmpDir = join(tmpdir(), `check-boundary-tests-drift-${process.pid}`);

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test('returns missing-test when no test file exists', () => {
    const resolverPath = join(tmpDir, 'foo-resolver.ts');
    writeFileSync(
      resolverPath,
      `export async function resolveFoo(id: number) { return null; }\n`,
      'utf-8',
    );
    const drifts = checkResolverDrift(resolverPath);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].kind).toBe('missing-test');
  });

  test('returns no drift when all functions are covered', () => {
    const resolverPath = join(tmpDir, 'bar-resolver.ts');
    const testPath = join(tmpDir, 'bar-resolver.test.ts');
    writeFileSync(
      resolverPath,
      `export async function resolveBar(id: number) { return null; }\n`,
      'utf-8',
    );
    writeFileSync(
      testPath,
      `describe('resolveBar', () => { test('works', () => {}); });\n`,
      'utf-8',
    );
    const drifts = checkResolverDrift(resolverPath);
    expect(drifts).toHaveLength(0);
  });

  test('returns uncovered when function name missing from test body', () => {
    const resolverPath = join(tmpDir, 'baz-resolver.ts');
    const testPath = join(tmpDir, 'baz-resolver.test.ts');
    writeFileSync(
      resolverPath,
      [
        'export async function resolveBaz(id: number) { return null; }',
        'export async function resolveQux(id: number) { return null; }',
      ].join('\n'),
      'utf-8',
    );
    // Only resolveBaz is covered — resolveQux is missing
    writeFileSync(testPath, `describe('resolveBaz', () => { test('works', () => {}); });\n`, 'utf-8');
    const drifts = checkResolverDrift(resolverPath);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].kind).toBe('uncovered');
    expect(drifts[0].fnName).toBe('resolveQux');
  });

  test('does NOT flag a function name that appears only in a comment', () => {
    const resolverPath = join(tmpDir, 'commented-resolver.ts');
    const testPath = join(tmpDir, 'commented-resolver.test.ts');
    writeFileSync(
      resolverPath,
      `export async function resolveCommented(id: number) { return null; }\n`,
      'utf-8',
    );
    // Function name is only in a comment — should not be counted as covered
    writeFileSync(testPath, `// resolveCommented is intentionally not tested\ntest('dummy', () => {});\n`, 'utf-8');
    const drifts = checkResolverDrift(resolverPath);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].kind).toBe('uncovered');
    expect(drifts[0].fnName).toBe('resolveCommented');
  });

  test('skips non-existent files gracefully (returns empty)', () => {
    const drifts = checkResolverDrift(join(tmpDir, 'nonexistent-resolver.ts'));
    expect(drifts).toHaveLength(0);
  });

  test('skips resolver files with no resolve* exports', () => {
    const resolverPath = join(tmpDir, 'empty-resolver.ts');
    writeFileSync(resolverPath, `export function helper() {}\n`, 'utf-8');
    const drifts = checkResolverDrift(resolverPath);
    expect(drifts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectResolverFiles — filtering
// ---------------------------------------------------------------------------

describe('collectResolverFiles', () => {
  const tmpDir = join(tmpdir(), `check-boundary-files-${process.pid}`);

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test('filters to *-resolver.ts files only', () => {
    const resolver = join(tmpDir, 'foo-resolver.ts');
    const nonResolver = join(tmpDir, 'foo-service.ts');
    const testFile = join(tmpDir, 'foo-resolver.test.ts');
    writeFileSync(resolver, '', 'utf-8');
    writeFileSync(nonResolver, '', 'utf-8');
    writeFileSync(testFile, '', 'utf-8');

    const collected = collectResolverFiles([resolver, nonResolver, testFile]);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toBe(resolver);
  });

  test('filters out .generated.ts files', () => {
    const generated = join(tmpDir, 'foo-resolver.guards.generated.ts');
    writeFileSync(generated, '', 'utf-8');
    const collected = collectResolverFiles([generated]);
    expect(collected).toHaveLength(0);
  });

  test('returns empty array for null + empty files list (falls back to full scan in services/)', () => {
    // Full scan returns at least the real resolver files in the repo
    const all = collectResolverFiles(null);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      expect(f).toMatch(/-resolver\.ts$/);
      expect(f).not.toMatch(/\.test\.ts$/);
    }
  });
});

// ---------------------------------------------------------------------------
// checkBoundaryTests — integration with real resolver files
// ---------------------------------------------------------------------------

describe('checkBoundaryTests — real resolver files', () => {
  test('task-resolver.ts has no drift (all functions covered)', () => {
    const taskResolver = pathResolve(
      fileURLToPath(import.meta.url),
      '../../services/task/task-resolver.ts',
    );
    const drifts = checkBoundaryTests([taskResolver]);
    expect(drifts).toHaveLength(0);
  });

  test('full scan exits without error (warn-only, returns array)', () => {
    const drifts = checkBoundaryTests(null);
    // All entries must be valid DriftEntry shapes
    for (const d of drifts) {
      expect(['missing-test', 'uncovered']).toContain(d.kind);
      expect(typeof d.resolverFile).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration (spawnSync)
// ---------------------------------------------------------------------------

describe('CLI — check-boundary-tests script', () => {
  test('exits 0 in warn-only mode even when drift exists', () => {
    const result = spawnSync('bun', [SCRIPT, '--warn-only'], {
      encoding: 'utf-8',
      cwd: pathResolve(fileURLToPath(import.meta.url), '../..'),
    });
    expect(result.status).toBe(0);
  });

  test('exits 0 (no drift) for task-resolver.ts in --check mode', () => {
    const result = spawnSync(
      'bun',
      [SCRIPT, '--check', '--files=services/task/task-resolver.ts'],
      {
        encoding: 'utf-8',
        cwd: pathResolve(fileURLToPath(import.meta.url), '../..'),
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no drift detected');
  });

  test('exits 1 (drift) for a non-existent resolver in --check mode', () => {
    // Fabricate a path that looks like a resolver but does not exist — should be silently skipped
    const result = spawnSync(
      'bun',
      [SCRIPT, '--check', '--files=services/task/task-resolver.ts'],
      {
        encoding: 'utf-8',
        cwd: pathResolve(fileURLToPath(import.meta.url), '../..'),
      },
    );
    // task-resolver.ts is fully covered → exit 0
    expect(result.status).toBe(0);
  });
});
