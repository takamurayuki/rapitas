import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findRelatedTestFiles, buildScopedTestCommands, TEST_FILE_RE } from './related-tests';

describe('TEST_FILE_RE', () => {
  test('matches conventional test-file suffixes', () => {
    expect(TEST_FILE_RE.test('foo.test.ts')).toBe(true);
    expect(TEST_FILE_RE.test('foo.spec.tsx')).toBe(true);
    expect(TEST_FILE_RE.test('foo.test.mjs')).toBe(true);
    expect(TEST_FILE_RE.test('foo.test.cjs')).toBe(true);
  });

  test('does not match a plain source file', () => {
    expect(TEST_FILE_RE.test('foo.ts')).toBe(false);
    expect(TEST_FILE_RE.test('footest.ts')).toBe(false);
  });
});

describe('findRelatedTestFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'related-tests-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('finds a same-directory name.test.ts for a changed source file', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'src', 'foo.test.ts'), '');

    const result = findRelatedTestFiles(root, ['src/foo.ts']);
    expect(result).toEqual(['src/foo.test.ts']);
  });

  test('finds a test in a co-located __tests__ directory', () => {
    mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'src', '__tests__', 'foo.test.ts'), '');

    const result = findRelatedTestFiles(root, ['src/foo.ts']);
    expect(result).toEqual(['src/__tests__/foo.test.ts']);
  });

  test('finds a matching basename inside a project-level tests/ tree', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests', 'services'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'tests', 'services', 'foo.test.ts'), '');

    const result = findRelatedTestFiles(root, ['src/foo.ts']);
    expect(result).toEqual(['tests/services/foo.test.ts']);
  });

  test('excludes an integration/ subdirectory of tests/', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests', 'integration'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'tests', 'integration', 'foo.test.ts'), '');

    const result = findRelatedTestFiles(root, ['src/foo.ts']);
    expect(result).toEqual([]);
  });

  test('returns [] when the changed file list is only test files', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const result = findRelatedTestFiles(root, ['src/foo.test.ts']);
    expect(result).toEqual([]);
  });

  test('returns [] when nothing matches', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    const result = findRelatedTestFiles(root, ['src/foo.ts']);
    expect(result).toEqual([]);
  });

  test('dedupes and sorts results across multiple changed sources', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'b.ts'), '');
    writeFileSync(join(root, 'src', 'b.test.ts'), '');
    writeFileSync(join(root, 'src', 'a.ts'), '');
    writeFileSync(join(root, 'src', 'a.test.ts'), '');

    const result = findRelatedTestFiles(root, ['src/a.ts', 'src/b.ts']);
    expect(result).toEqual(['src/a.test.ts', 'src/b.test.ts']);
  });

  test('handles a nonexistent tests/ root gracefully', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    expect(() => findRelatedTestFiles(root, ['src/foo.ts'])).not.toThrow();
  });
});

describe('buildScopedTestCommands', () => {
  let root: string;
  const originalEnv = process.env.RAPITAS_VERIFY_TESTS;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scoped-cmd-'));
    delete process.env.RAPITAS_VERIFY_TESTS;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.RAPITAS_VERIFY_TESTS;
    else process.env.RAPITAS_VERIFY_TESTS = originalEnv;
  });

  test('returns null when RAPITAS_VERIFY_TESTS=0', () => {
    process.env.RAPITAS_VERIFY_TESTS = '0';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }));
    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('returns null when package.json is missing', () => {
    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('returns null when package.json has no test script', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('returns null for a malformed package.json', () => {
    writeFileSync(join(root, 'package.json'), '{ not valid json');
    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('returns a scoped bun test command when a bun.lock exists and a related test is found', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }));
    writeFileSync(join(root, 'bun.lock'), '');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'src', 'foo.test.ts'), '');

    const result = buildScopedTestCommands(root, root, ['src/foo.ts']);
    expect(result).not.toBeNull();
    expect(result![0]).toContain('bun test --isolate');
    expect(result![0]).toContain('src/foo.test.ts');
  });

  test('returns null for bun when no test is in scope (does not full-suite)', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }));
    writeFileSync(join(root, 'bun.lock'), '');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');

    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('includes the changed test file itself even with no related source test', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }));
    writeFileSync(join(root, 'bun.lock'), '');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.test.ts'), '');

    const result = buildScopedTestCommands(root, root, ['src/foo.test.ts']);
    expect(result).not.toBeNull();
    expect(result![0]).toContain('src/foo.test.ts');
  });

  test('returns a vitest command for a vitest-based non-bun project', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'src', 'foo.test.ts'), '');

    const result = buildScopedTestCommands(root, root, ['src/foo.ts']);
    expect(result).not.toBeNull();
    expect(result![0]).toContain('vitest run');
    expect(result![0]).toContain('src/foo.test.ts');
  });

  test('returns null for a non-bun/non-vitest runner when opt-in env is not set', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
  });

  test('opts into full-suite npm run test when RAPITAS_VERIFY_TESTS=1 for a non-scopeable runner', () => {
    process.env.RAPITAS_VERIFY_TESTS = '1';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    const result = buildScopedTestCommands(root, root, ['src/foo.ts']);
    expect(result).toEqual(['npm run test']);
  });

  test('uses pnpm run test when a pnpm-lock.yaml is present and opted in', () => {
    process.env.RAPITAS_VERIFY_TESTS = 'true';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const result = buildScopedTestCommands(root, root, ['src/foo.ts']);
    expect(result).toEqual(['pnpm run test']);
  });
});
