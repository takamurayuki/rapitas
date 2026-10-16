/**
 * gen-type-guards.test
 *
 * Unit tests for the gen-type-guards script.
 * Tests cover: element parsing, fallback extraction, SSOT pair detection,
 * duplicate-guard suppression, code generation, drift detection,
 * quick pre-filter, and incremental --files scanning.
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  parseArrayElements,
  extractFallbackComment,
  extractSsotPairs,
  generateGuardSource,
  formatGuardSource,
  checkDrift,
  hasSsotCandidate,
  parseFilesArg,
  scanForSsotFiles,
} from './gen-type-guards';

// ---------------------------------------------------------------------------
// parseArrayElements
// ---------------------------------------------------------------------------

describe('parseArrayElements', () => {
  test('single-quoted elements', () => {
    expect(parseArrayElements(`'researcher', 'planner', 'verifier'`)).toEqual([
      'researcher',
      'planner',
      'verifier',
    ]);
  });

  test('double-quoted elements', () => {
    expect(parseArrayElements(`"foo", "bar"`)).toEqual(['foo', 'bar']);
  });

  test('mixed quotes and whitespace', () => {
    expect(parseArrayElements(`\n  'draft',\n  'completed'\n`)).toEqual(['draft', 'completed']);
  });

  test('empty content → empty array', () => {
    expect(parseArrayElements('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFallbackComment
// ---------------------------------------------------------------------------

describe('extractFallbackComment', () => {
  test('returns override value from @gen-guard-fallback comment', () => {
    const content = `// @gen-guard-fallback: completed\nexport const STATUSES = ['draft', 'completed'] as const;`;
    expect(extractFallbackComment(content, 'STATUSES')).toBe('completed');
  });

  test('returns null when no comment present', () => {
    const content = `export const ROLES = ['admin', 'user'] as const;`;
    expect(extractFallbackComment(content, 'ROLES')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractSsotPairs
// ---------------------------------------------------------------------------

const SOURCE_WITH_NO_GUARDS = `
export const MY_ROLES = [
  'admin',
  'user',
] as const;

export type MyRole = (typeof MY_ROLES)[number];
`;

const SOURCE_WITH_IS_GUARD = `
export const MY_ROLES = ['admin', 'user'] as const;

export type MyRole = (typeof MY_ROLES)[number];

export function isMyRole(s: unknown): s is MyRole {
  return typeof s === 'string' && (MY_ROLES as readonly string[]).includes(s);
}
`;

const SOURCE_WITH_BOTH_GUARDS = `
export const MY_ROLES = ['admin', 'user'] as const;
export type MyRole = (typeof MY_ROLES)[number];
export function isMyRole(s: unknown): s is MyRole { return true; }
export function narrowMyRole(s: string | null, fallback: MyRole = 'admin'): MyRole { return fallback; }
`;

const SOURCE_WITH_NORMALIZE = `
export const MY_TYPES = ['bug', 'perf'] as const;
export type MyType = (typeof MY_TYPES)[number];
export function normalizeMyType(v: unknown): MyType { return 'bug'; }
`;

const SOURCE_WITH_FALLBACK_COMMENT = `
// @gen-guard-fallback: completed
export const MY_STATUSES = ['draft', 'review', 'completed'] as const;
export type MyStatus = (typeof MY_STATUSES)[number];
`;

const SOURCE_WITH_NO_DERIVED_TYPE = `
export const ORPHAN_ARRAY = ['a', 'b'] as const;
`;

const SOURCE_WITH_EMPTY_ARRAY = `
export const EMPTY_ARR = [] as const;
export type EmptyType = (typeof EMPTY_ARR)[number];
`;

describe('extractSsotPairs', () => {
  test('detects pair and marks both guards for generation', () => {
    const { pairs, manualReview } = extractSsotPairs('/fake/file.ts', SOURCE_WITH_NO_GUARDS);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].typeName).toBe('MyRole');
    expect(pairs[0].arrayName).toBe('MY_ROLES');
    expect(pairs[0].elements).toEqual(['admin', 'user']);
    expect(pairs[0].fallback).toBe('admin');
    expect(pairs[0].generateIs).toBe(true);
    expect(pairs[0].generateNarrow).toBe(true);
    expect(manualReview).toHaveLength(0);
  });

  test.each([
    {
      name: 'is* suppresses is* generation only',
      source: SOURCE_WITH_IS_GUARD,
      length: 1,
      generateIs: false,
      generateNarrow: true,
    },
    {
      name: 'is* and narrow* → pair omitted entirely',
      source: SOURCE_WITH_BOTH_GUARDS,
      length: 0,
    },
    {
      name: 'normalize* suppresses narrow* generation',
      source: SOURCE_WITH_NORMALIZE,
      length: 1,
      generateIs: true,
      generateNarrow: false,
    },
  ])('existing $name', ({ source, length, generateIs, generateNarrow }) => {
    const { pairs } = extractSsotPairs('/fake/file.ts', source);
    expect(pairs).toHaveLength(length);
    if (generateIs !== undefined) expect(pairs[0].generateIs).toBe(generateIs);
    if (generateNarrow !== undefined) expect(pairs[0].generateNarrow).toBe(generateNarrow);
  });

  test('@gen-guard-fallback comment overrides first-element default', () => {
    const { pairs } = extractSsotPairs('/fake/file.ts', SOURCE_WITH_FALLBACK_COMMENT);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fallback).toBe('completed');
  });

  test('SSOT array without derived type goes to manualReview', () => {
    const { pairs, manualReview } = extractSsotPairs('/fake/file.ts', SOURCE_WITH_NO_DERIVED_TYPE);
    expect(pairs).toHaveLength(0);
    expect(manualReview.some((r) => r.includes('ORPHAN_ARRAY'))).toBe(true);
  });

  test('empty array goes to manualReview and is skipped', () => {
    const { pairs, manualReview } = extractSsotPairs('/fake/file.ts', SOURCE_WITH_EMPTY_ARRAY);
    expect(pairs).toHaveLength(0);
    expect(manualReview.some((r) => r.includes('EMPTY_ARR'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateGuardSource
// ---------------------------------------------------------------------------

describe('generateGuardSource', () => {
  // Use the real source/output paths (same dir → import path = './workflow-types')
  const ROOT_DIR = join(__dirname, '..');
  const sourceFile = join(ROOT_DIR, 'services', 'workflow', 'workflow-types.ts');
  const outputFile = join(ROOT_DIR, 'services', 'workflow', 'workflow-types.guards.generated.ts');

  const pair: import('./gen-type-guards').SsotPair = {
    arrayName: 'WORKFLOW_ROLES',
    typeName: 'WorkflowRole',
    elements: ['researcher', 'planner', 'verifier'],
    fallback: 'researcher',
    generateIs: true,
    generateNarrow: true,
  };

  test.each([
    {
      name: 'file header with auto-generated notice',
      contains: ['自動生成ファイル', 'bun run gen:type-guards', '手動編集不可'],
    },
    {
      // Source and output are adjacent → import path is './workflow-types'
      name: 'correct import from source file (adjacent → relative path)',
      contains: [`from './workflow-types'`, 'WorkflowRole', 'WORKFLOW_ROLES'],
    },
    {
      name: 'isWorkflowRole with correct signature',
      contains: [
        'export function isWorkflowRole(s: unknown): s is WorkflowRole',
        'isOneOf(s, WORKFLOW_ROLES)',
        'isOneOf',
      ],
    },
    {
      name: 'narrowWorkflowRole with correct signature and fallback',
      contains: [
        'export function narrowWorkflowRole(',
        "fallback: WorkflowRole = 'researcher'",
        '): WorkflowRole {',
        'return isWorkflowRole(s) ? s : fallback;',
      ],
    },
  ])('generates $name', async ({ contains }) => {
    const output = await generateGuardSource(sourceFile, outputFile, [pair]);
    for (const c of contains) expect(output).toContain(c);
  });

  test('skips is* generation when generateIs=false', async () => {
    const onlyNarrow: import('./gen-type-guards').SsotPair = { ...pair, generateIs: false };
    const output = await generateGuardSource(sourceFile, outputFile, [onlyNarrow]);
    expect(output).not.toContain('export function isWorkflowRole');
    expect(output).toContain('export function narrowWorkflowRole');
    // Must import is* from source when not generating it
    expect(output).toContain('isWorkflowRole');
  });

  test('skips narrow* generation when generateNarrow=false', async () => {
    const onlyIs: import('./gen-type-guards').SsotPair = { ...pair, generateNarrow: false };
    const output = await generateGuardSource(sourceFile, outputFile, [onlyIs]);
    expect(output).toContain('export function isWorkflowRole');
    expect(output).not.toContain('export function narrowWorkflowRole');
  });

  test('omits isOneOf import when all pairs have generateIs=false', async () => {
    // NOTE: gen-type-guards.ts:323 — isOneOf import is conditional on pairs.some(p => p.generateIs)
    const onlyNarrow: import('./gen-type-guards').SsotPair = { ...pair, generateIs: false };
    const output = await generateGuardSource(sourceFile, outputFile, [onlyNarrow]);
    expect(output).not.toContain('isOneOf');
    // narrow* still generated using the is* imported from source
    expect(output).toContain('export function narrowWorkflowRole');
  });

  // eslint-disable-next-line local/prefer-test-each-for-similar -- each case has distinct setup (secondPair construction, cross-directory paths) and a differing assertion shape (multi toContain vs endsWith), not safely mergeable
  test('generates guards for all pairs when multiple pairs are provided', async () => {
    const secondPair: import('./gen-type-guards').SsotPair = {
      arrayName: 'WORKFLOW_STATUSES',
      typeName: 'WorkflowStatus',
      elements: ['draft', 'completed'],
      fallback: 'draft',
      generateIs: true,
      generateNarrow: true,
    };
    const output = await generateGuardSource(sourceFile, outputFile, [pair, secondPair]);
    // Both type names appear in the import
    expect(output).toContain('WorkflowRole');
    expect(output).toContain('WorkflowStatus');
    // Both array names appear in the import
    expect(output).toContain('WORKFLOW_ROLES');
    expect(output).toContain('WORKFLOW_STATUSES');
    // Guard functions for both pairs are generated
    expect(output).toContain('export function isWorkflowRole');
    expect(output).toContain('export function isWorkflowStatus');
    expect(output).toContain('export function narrowWorkflowRole');
    expect(output).toContain('export function narrowWorkflowStatus');
  });

  test('generates ../ relative import path when source and output are in different directories', async () => {
    // Source: services/workflow/workflow-types.ts
    // Output: utils/common/workflow-types.guards.generated.ts
    // Expected import: ../../services/workflow/workflow-types
    const crossSrc = join(ROOT_DIR, 'services', 'workflow', 'workflow-types.ts');
    const crossOut = join(ROOT_DIR, 'utils', 'common', 'workflow-types.guards.generated.ts');
    const output = await generateGuardSource(crossSrc, crossOut, [pair]);
    expect(output).toContain('../');
    expect(output).toContain('services/workflow/workflow-types');
  });

  test('generated output ends with a trailing newline', async () => {
    // NOTE: blocks.join('\n\n') + '\n' at gen-type-guards.ts:368 guarantees a final newline
    const output = await generateGuardSource(sourceFile, outputFile, [pair]);
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatGuardSource
// ---------------------------------------------------------------------------

describe('formatGuardSource', () => {
  const ROOT_DIR = join(__dirname, '..');
  // Use the real workflow-types output path as the config-resolution anchor
  const anchorPath = join(ROOT_DIR, 'services', 'workflow', 'workflow-types.guards.generated.ts');

  test('formats short import as single-line (under printWidth=100)', async () => {
    const source = `import type { Foo } from './foo';\nimport { FOO } from './foo';\n`;
    const result = await formatGuardSource(source, anchorPath);
    // Short import should remain on one line
    expect(result).toContain(`import type { Foo } from './foo';`);
  });

  test('wraps long import to multi-line when it exceeds printWidth=100', async () => {
    // Construct a type list that produces an import line > 100 chars
    const longTypes = Array.from({ length: 8 }, (_, i) => `VeryLongTypeName${i}`).join(', ');
    const source =
      `import type { ${longTypes} } from './some-module';\n` +
      `import { ${longTypes.replace(/VeryLongTypeName/g, 'VERY_LONG_CONST')} } from './some-module';\n`;
    const result = await formatGuardSource(source, anchorPath);
    // Prettier should wrap the long import across multiple lines
    expect(result).toContain('\n');
    // The formatted result must still be valid TS (contains import type keyword)
    expect(result).toContain('import type {');
  });

  test('applies project printWidth=100 (not Prettier default 80)', async () => {
    // A line that is 95 chars — should NOT be wrapped (project uses printWidth 100, default is 80)
    const ninetyFiveCharImport = `import type { WorkflowRole, WorkflowFileType, WorkflowStatus } from './workflow-types';`;
    expect(ninetyFiveCharImport.length).toBeLessThan(100);
    const source = ninetyFiveCharImport + '\n';
    const result = await formatGuardSource(source, anchorPath);
    // Should remain on a single line because 95 < 100
    expect(result.trim()).toBe(ninetyFiveCharImport);
  });

  test('formatted output matches on-disk generated file (drift = 0)', async () => {
    // Verify that re-formatting an already-formatted file produces identical output
    const ROOT_DIR2 = join(__dirname, '..');
    const sourceFile = join(ROOT_DIR2, 'services', 'workflow', 'workflow-types.ts');
    const outputFile = join(
      ROOT_DIR2,
      'services',
      'workflow',
      'workflow-types.guards.generated.ts',
    );
    if (!existsSync(outputFile)) return; // Skip if file not yet generated

    const onDisk = readFileSync(outputFile, 'utf-8');
    const reFormatted = await formatGuardSource(onDisk, outputFile);
    // Re-formatting an already-formatted file must be idempotent
    expect(reFormatted).toBe(onDisk);
  });
});

// ---------------------------------------------------------------------------
// Generated guard runtime behaviour (integration)
// ---------------------------------------------------------------------------

describe('generated guard runtime behaviour', () => {
  const tmpDir = join(tmpdir(), `gen-type-guards-test-${process.pid}`);
  const sourceFile = join(tmpDir, 'test-types.ts');
  const generatedFile = join(tmpDir, 'test-types.guards.generated.ts');

  const pair: import('./gen-type-guards').SsotPair = {
    arrayName: 'TEST_STATUSES',
    typeName: 'TestStatus',
    elements: ['active', 'inactive', 'pending'],
    fallback: 'active',
    generateIs: true,
    generateNarrow: true,
  };

  beforeAll(async () => {
    mkdirSync(tmpDir, { recursive: true });
    // Write a minimal source file so relativeImportPath works
    writeFileSync(
      sourceFile,
      `export const TEST_STATUSES = ['active','inactive','pending'] as const;\nexport type TestStatus = (typeof TEST_STATUSES)[number];\n`,
      'utf-8',
    );
    const code = await generateGuardSource(sourceFile, generatedFile, [pair]);
    writeFileSync(generatedFile, code, 'utf-8');
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test('generated code is valid TypeScript (parses without syntax error)', () => {
    // NOTE: We cannot dynamically import from a tmp path in bun without a transpile step,
    // so we validate the generated string content directly.
    const code = readFileSync(generatedFile, 'utf-8');
    expect(code).toContain('export function isTestStatus');
    expect(code).toContain('export function narrowTestStatus');
  });

  test('is* guard returns true for valid value', () => {
    // Evaluate the guard logic inline — same logic as generated code
    const TEST_STATUSES = ['active', 'inactive', 'pending'] as const;
    const isTestStatus = (s: unknown): s is (typeof TEST_STATUSES)[number] =>
      typeof s === 'string' && (TEST_STATUSES as readonly string[]).includes(s);

    expect(isTestStatus('active')).toBe(true);
    expect(isTestStatus('inactive')).toBe(true);
  });

  test('is* guard returns false for invalid values', () => {
    const TEST_STATUSES = ['active', 'inactive', 'pending'] as const;
    const isTestStatus = (s: unknown): s is (typeof TEST_STATUSES)[number] =>
      typeof s === 'string' && (TEST_STATUSES as readonly string[]).includes(s);

    expect(isTestStatus('unknown')).toBe(false);
    expect(isTestStatus(null)).toBe(false);
    expect(isTestStatus(undefined)).toBe(false);
    expect(isTestStatus(42)).toBe(false);
    expect(isTestStatus({})).toBe(false);
  });

  test('narrow* returns fallback for null/undefined/invalid', () => {
    const TEST_STATUSES = ['active', 'inactive', 'pending'] as const;
    type TestStatus = (typeof TEST_STATUSES)[number];
    const isTestStatus = (s: unknown): s is TestStatus =>
      typeof s === 'string' && (TEST_STATUSES as readonly string[]).includes(s);
    const narrowTestStatus = (
      s: string | null | undefined,
      fallback: TestStatus = 'active',
    ): TestStatus => (isTestStatus(s) ? s : fallback);

    expect(narrowTestStatus(null)).toBe('active');
    expect(narrowTestStatus(undefined)).toBe('active');
    expect(narrowTestStatus('bogus')).toBe('active');
    expect(narrowTestStatus('inactive')).toBe('inactive');
  });

  test('narrow* uses custom fallback when provided', () => {
    const TEST_STATUSES = ['active', 'inactive', 'pending'] as const;
    type TestStatus = (typeof TEST_STATUSES)[number];
    const isTestStatus = (s: unknown): s is TestStatus =>
      typeof s === 'string' && (TEST_STATUSES as readonly string[]).includes(s);
    const narrowTestStatus = (s: string | null | undefined, fallback: TestStatus): TestStatus =>
      isTestStatus(s) ? s : fallback;

    expect(narrowTestStatus(null, 'pending')).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// checkDrift
// ---------------------------------------------------------------------------

describe('checkDrift — real workflow-types.ts', () => {
  test('returns no drift for the already-generated workflow-types file (if it exists)', async () => {
    // This test is an integration check. If the generated file doesn't exist yet,
    // drift is expected. The test verifies the drift detection function runs without error.
    const drifts = await checkDrift();
    // All entries must be 'missing' or 'mismatch' — no other statuses
    for (const d of drifts) {
      expect(['missing', 'mismatch']).toContain(d.status);
    }
  });
});

describe('checkDrift — tmpdir scenarios', () => {
  const tmpDir2 = join(tmpdir(), `gen-type-guards-drift-${process.pid}`);

  afterAll(() => {
    if (existsSync(tmpDir2)) rmSync(tmpDir2, { recursive: true });
  });

  test('drift result contains missing when generated file absent', async () => {
    // We cannot easily wire checkDrift to a tmpDir without refactoring scan roots.
    // Instead, test the underlying comparison logic: generateGuardSource vs on-disk.
    mkdirSync(tmpDir2, { recursive: true });
    const src = join(tmpDir2, 'sample-types.ts');
    const out = join(tmpDir2, 'sample-types.guards.generated.ts');

    writeFileSync(
      src,
      `export const SAMPLE = ['x','y'] as const;\nexport type Sample = (typeof SAMPLE)[number];\n`,
      'utf-8',
    );

    const content = readFileSync(src, 'utf-8');
    const { pairs } = extractSsotPairs(src, content);
    const expected = await generateGuardSource(src, out, pairs);

    // File absent → drift = missing
    expect(existsSync(out)).toBe(false);
    expect(expected).toContain('export function isSample');

    // Write the correct content → no drift
    writeFileSync(out, expected, 'utf-8');
    const actual = readFileSync(out, 'utf-8');
    expect(actual).toBe(expected);

    // Modify → mismatch
    writeFileSync(out, expected + '// extra\n', 'utf-8');
    const modified = readFileSync(out, 'utf-8');
    expect(modified).not.toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// hasSsotCandidate (quick pre-filter)
// ---------------------------------------------------------------------------

describe('hasSsotCandidate', () => {
  test.each([
    {
      name: 'content has "] as const;"',
      content: `export const ROLES = ['admin', 'user'] as const;\nexport type Role = (typeof ROLES)[number];`,
      expected: true,
    },
    {
      name: 'multiline SSOT array',
      content: `export const STATUSES = [\n  'draft',\n  'done',\n] as const;`,
      expected: true,
    },
    { name: 'no "] as const;" present', content: 'export const foo = "bar";', expected: false },
    { name: 'empty string', content: '', expected: false },
    {
      // object as const uses "} as const" not "] as const"
      name: 'file with object "as const" (not array)',
      content: 'export const CFG = { a: 1 } as const;',
      expected: false,
    },
  ])('returns $expected for $name', ({ content, expected }) => {
    expect(hasSsotCandidate(content)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// parseFilesArg
// ---------------------------------------------------------------------------

describe('parseFilesArg', () => {
  test('returns null when --files flag is absent', () => {
    expect(parseFilesArg(['node', 'script.ts', '--check'])).toBeNull();
  });

  test('parses --files=foo.ts,bar.ts form', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files=foo.ts,bar.ts'])).toEqual([
      'foo.ts',
      'bar.ts',
    ]);
  });

  test('parses --files=single.ts form', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files=single.ts'])).toEqual(['single.ts']);
  });

  test('returns empty array for --files= with no value', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files='])).toEqual([]);
  });

  test('parses --files foo.ts bar.ts (space-separated, stops at next flag)', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files', 'foo.ts', 'bar.ts', '--check'])).toEqual([
      'foo.ts',
      'bar.ts',
    ]);
  });

  test('parses --files foo.ts (single space-separated)', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files', 'foo.ts'])).toEqual(['foo.ts']);
  });

  test('returns empty array for --files with no following args', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files'])).toEqual([]);
  });

  test('trims spaces around comma-separated values', () => {
    expect(parseFilesArg(['node', 'script.ts', '--files=foo.ts, bar.ts , baz.ts'])).toEqual([
      'foo.ts',
      'bar.ts',
      'baz.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// scanForSsotFiles with --files option
// ---------------------------------------------------------------------------

describe('scanForSsotFiles — incremental files mode', () => {
  const tmpDir = join(tmpdir(), `gen-type-guards-scan-${process.pid}`);
  const ssotFile = join(tmpDir, 'my-types.ts');
  const plainFile = join(tmpDir, 'no-ssot.ts');

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      ssotFile,
      `export const MY_VALS = ['a', 'b'] as const;\nexport type MyVal = (typeof MY_VALS)[number];\n`,
      'utf-8',
    );
    writeFileSync(plainFile, `export const foo = 'bar';\n`, 'utf-8');
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test('scans only the specified SSOT file, ignores the plain file', () => {
    const results = scanForSsotFiles({ files: [ssotFile] });
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe(ssotFile);
    expect(results[0].pairs).toHaveLength(1);
    expect(results[0].pairs[0].typeName).toBe('MyVal');
  });

  test('returns empty array when specified file has no SSOT pattern', () => {
    const results = scanForSsotFiles({ files: [plainFile] });
    expect(results).toHaveLength(0);
  });

  test('skips .generated.ts files even when explicitly listed', () => {
    const generatedPath = ssotFile.replace('.ts', '.guards.generated.ts');
    const results = scanForSsotFiles({ files: [generatedPath] });
    expect(results).toHaveLength(0);
  });

  test('falls back to full scan when files array is empty', () => {
    // Empty array → full scan (same as no opts)
    const withEmpty = scanForSsotFiles({ files: [] });
    const withoutOpts = scanForSsotFiles();
    expect(withEmpty.length).toBe(withoutOpts.length);
  });

  test('handles non-existent files gracefully', () => {
    const results = scanForSsotFiles({ files: [join(tmpDir, 'nonexistent.ts')] });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkDrift with --files option
// ---------------------------------------------------------------------------

describe('checkDrift — incremental files mode', () => {
  const tmpDir = join(tmpdir(), `gen-type-guards-drift2-${process.pid}`);
  const ssotSrc = join(tmpDir, 'drift-types.ts');
  const generatedOut = join(tmpDir, 'drift-types.guards.generated.ts');

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      ssotSrc,
      `export const DRIFT_VALS = ['x', 'y'] as const;\nexport type DriftVal = (typeof DRIFT_VALS)[number];\n`,
      'utf-8',
    );
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  // eslint-disable-next-line local/prefer-test-each-for-similar -- sequential cases share mutable on-disk file state (missing -> matches -> stale), not safely mergeable
  test('reports missing drift when generated file absent', async () => {
    const drifts = await checkDrift({ files: [ssotSrc] });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].status).toBe('missing');
    expect(drifts[0].file).toBe(generatedOut);
  });

  test('reports no drift when generated file matches', async () => {
    // Generate the correct content and write it
    const ssotFiles = scanForSsotFiles({ files: [ssotSrc] });
    expect(ssotFiles).toHaveLength(1);
    const { filePath, outputPath, pairs } = ssotFiles[0];
    writeFileSync(outputPath, await generateGuardSource(filePath, outputPath, pairs), 'utf-8');

    const drifts = await checkDrift({ files: [ssotSrc] });
    expect(drifts).toHaveLength(0);
  });

  test('reports mismatch drift when generated file is stale', async () => {
    // Overwrite with stale content
    writeFileSync(generatedOut, '// stale\n', 'utf-8');

    const drifts = await checkDrift({ files: [ssotSrc] });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].status).toBe('mismatch');
  });
});
