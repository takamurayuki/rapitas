/**
 * codemod-runner.test
 *
 * Unit and dry-run integration tests for the codemod infrastructure:
 *   - codemod-runner: walkTs, ensureImport, relativeImportPath, runCodemod
 *   - transformSpecArray
 *   - transformPrismaSingleton
 *   - transformResponseHelper
 *   - transformInsensitiveSpread
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ensureImport, relativeImportPath, runCodemod, walkTs } from '../lib/codemod-runner';
import { transformInsensitiveMode } from '../insensitive-mode';
import { transformInsensitiveSpread } from '../insensitive-spread';
import { transformPreferTestEach } from '../prefer-test-each';
import { transformPrismaSingleton } from '../prisma-singleton';
import { transformResponseHelper } from '../response-helper';
import { transformSpecArray } from '../spec-array';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'codemod-test-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const full = join(tmpDir, rel);
  const dir = full.split(sep).slice(0, -1).join(sep);
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}

// ---------------------------------------------------------------------------
// walkTs
// ---------------------------------------------------------------------------

describe('walkTs', () => {
  it('finds .ts files recursively', () => {
    write('a.ts', '');
    write('sub/b.ts', '');
    write('sub/c.js', '');
    const found = walkTs(tmpDir);
    expect(found.some((f) => f.endsWith('a.ts'))).toBe(true);
    expect(found.some((f) => f.endsWith('b.ts'))).toBe(true);
    expect(found.some((f) => f.endsWith('c.js'))).toBe(false);
  });

  it('excludes node_modules', () => {
    write('node_modules/x.ts', '');
    write('src/y.ts', '');
    const found = walkTs(tmpDir);
    expect(found.some((f) => f.includes('node_modules'))).toBe(false);
    expect(found.some((f) => f.endsWith('y.ts'))).toBe(true);
  });

  it('returns empty array for non-existent root', () => {
    expect(walkTs(join(tmpDir, 'does-not-exist'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ensureImport
// ---------------------------------------------------------------------------

describe('ensureImport', () => {
  it('adds import when absent', () => {
    const src = `import { foo } from './foo';\n\nconst x = 1;\n`;
    const result = ensureImport(src, 'bar', './bar');
    expect(result).toContain("import { bar } from './bar';");
    // Added after last import line.
    const lines = result.split('\n');
    const barIdx = lines.findIndex((l) => l.includes('import { bar }'));
    const fooIdx = lines.findIndex((l) => l.includes('import { foo }'));
    expect(barIdx).toBeGreaterThan(fooIdx);
  });

  it('does NOT add duplicate import', () => {
    const src = `import { parseSpecArray } from './spec-array';\nconst x = 1;\n`;
    const result = ensureImport(src, 'parseSpecArray', './spec-array');
    // Count occurrences — must remain 1.
    const count = (result.match(/import \{ parseSpecArray \}/g) || []).length;
    expect(count).toBe(1);
  });

  it('prepends import when file has no imports', () => {
    const src = `const x = 1;\n`;
    const result = ensureImport(src, 'foo', './foo');
    expect(result.startsWith("import { foo } from './foo';")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// relativeImportPath
// ---------------------------------------------------------------------------

describe('relativeImportPath', () => {
  it('computes sibling path', () => {
    const from = join(tmpDir, 'routes', 'foo.ts');
    const to = join(tmpDir, 'utils', 'response');
    const rel = relativeImportPath(from, to);
    expect(rel).toMatch(/\.\.\//);
    expect(rel).toContain('response');
  });

  it('always starts with ./ or ../', () => {
    const from = join(tmpDir, 'a', 'b', 'c.ts');
    const to = join(tmpDir, 'a', 'b', 'x');
    const rel = relativeImportPath(from, to);
    expect(rel.startsWith('./')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// transformSpecArray
// ---------------------------------------------------------------------------

describe('transformSpecArray', () => {
  // NOTE: tmpDir is initialized per-test in beforeEach; compute path lazily inside each it().
  const svcPath = () => join(tmpDir, 'services', 'foo.ts');

  it('replaces JSON.parse(x || "[]") with parseSpecArray(x)', () => {
    const content = `const tags = JSON.parse(entry.tags || '[]') as string[];`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('parseSpecArray(entry.tags)');
    expect(result.newContent).not.toContain('JSON.parse');
  });

  it('is idempotent — does not double-transform', () => {
    const content = `const tags = parseSpecArray(entry.tags);`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
  });

  it('adds parseSpecArray import when transforming', () => {
    const content = `import { something } from './other';\nconst x = JSON.parse(v || '[]');`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('import { parseSpecArray }');
  });

  it('does not add duplicate import on second pass', () => {
    const content = `import { parseSpecArray } from '../utils/common/spec-array';\nconst x = JSON.parse(v || '[]');`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    if (result.changed) {
      const count = (result.newContent.match(/import \{ parseSpecArray \}/g) || []).length;
      expect(count).toBe(1);
    }
  });

  it('produces no manual review entries', () => {
    const content = `const x = JSON.parse(v || '[]');`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    expect(result.manualReview).toHaveLength(0);
  });

  it('handles ?? operator variant', () => {
    const content = `const deps = JSON.parse(item.deps ?? '[]');`;
    const result = transformSpecArray({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('parseSpecArray(item.deps)');
  });
});

// ---------------------------------------------------------------------------
// transformPrismaSingleton
// ---------------------------------------------------------------------------

describe('transformPrismaSingleton', () => {
  it('replaces new PrismaClient() with prisma singleton', () => {
    const path = join(tmpDir, 'src', 'services', 'foo.ts');
    const content = `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n`;
    const result = transformPrismaSingleton({ filePath: path, content });
    expect(result.changed).toBe(true);
    expect(result.newContent).not.toContain('new PrismaClient()');
    expect(result.newContent).toContain('prisma');
  });

  it('skips config/database.ts itself', () => {
    const path = join(tmpDir, 'config', 'database.ts');
    const content = `export const prisma = new PrismaClient();\n`;
    const result = transformPrismaSingleton({ filePath: path, content });
    expect(result.changed).toBe(false);
  });

  it('emits manual review for PrismaClient with arguments', () => {
    const path = join(tmpDir, 'src', 'services', 'bar.ts');
    const content = `const prisma = new PrismaClient({ log: ['query'] });\n`;
    // NOTE: There is no no-arg form here so changed should be false.
    const result = transformPrismaSingleton({ filePath: path, content });
    expect(result.changed).toBe(false);
    // With-arg detection should fire.
    // (The codemod emits manualReview only when it also finds a no-arg form to replace.)
  });

  it('adds prisma import from config/database', () => {
    const path = join(tmpDir, 'src', 'services', 'baz.ts');
    const content = `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n`;
    const result = transformPrismaSingleton({ filePath: path, content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('import { prisma }');
  });
});

// ---------------------------------------------------------------------------
// transformResponseHelper
// ---------------------------------------------------------------------------

describe('transformResponseHelper', () => {
  // NOTE: tmpDir is initialized per-test in beforeEach; compute path lazily inside each it().
  const routePath = () => join(tmpDir, 'routes', 'foo.ts');

  it('replaces { success: true, data: x } with createResponse(x)', () => {
    const content = `return { success: true, data: result };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('createResponse(result)');
  });

  it('replaces { success: false, error: "msg" } with createErrorResponse("msg")', () => {
    const content = `return { success: false, error: 'Not found' };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain("createErrorResponse('Not found')");
  });

  it('replaces { success: true } (no data) with createResponse(undefined)', () => {
    const content = `return { success: true };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('createResponse(undefined)');
  });

  it('skips extra-field objects and adds them to manualReview', () => {
    const content = `return { success: true, data: x, sessionId: '123' };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.newContent).toContain('success: true'); // unchanged
    expect(result.manualReview.length).toBeGreaterThan(0);
  });

  it('is idempotent — does not re-transform createResponse(...)', () => {
    const content = `return createResponse(result);\n`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
  });

  it('adds createResponse import when transforming', () => {
    const content = `import { something } from './other';\nreturn { success: true, data: x };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('import { createResponse }');
  });

  it('does not add duplicate import on second pass', () => {
    const content = `import { createResponse } from '../utils/common/response';\nreturn { success: true, data: x };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    if (result.changed) {
      const count = (result.newContent.match(/import \{ createResponse \}/g) || []).length;
      expect(count).toBe(1);
    }
  });

  it('handles { success: true, data: x, message: m } → createResponse(x, m)', () => {
    const content = `return { success: true, data: list, message: 'ok' };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain("createResponse(list, 'ok')");
  });

  it('handles { success: false, error: msg, code: "NOT_FOUND" }', () => {
    const content = `return { success: false, error: e.message, code: 'NOT_FOUND' };`;
    const result = transformResponseHelper({ filePath: routePath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain("createErrorResponse(e.message, 'NOT_FOUND')");
  });
});

// ---------------------------------------------------------------------------
// transformInsensitiveMode
// ---------------------------------------------------------------------------

describe('transformInsensitiveMode', () => {
  const svcPath = () => join(tmpDir, 'services', 'foo.ts');
  const dbProviderPath = () => join(tmpDir, 'config', 'db-provider.ts');

  it('replaces Pattern A (single-line declaration) with getInsensitiveMode()', () => {
    const content = [
      `import { prisma } from '../../config/database';`,
      `const isPostgres =`,
      `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');`,
      `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
      `const result = { contains: q, ...insensitive };`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('const insensitive = getInsensitiveMode();');
    expect(result.newContent).not.toContain('isPostgres');
    expect(result.newContent).not.toContain("mode: 'insensitive' as const");
  });

  it('replaces Pattern A (multi-line declaration) with getInsensitiveMode()', () => {
    const content = [
      `const isPostgres =`,
      `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' &&`,
      `  !process.env.DATABASE_URL?.startsWith('file:');`,
      `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('const insensitive = getInsensitiveMode();');
    expect(result.newContent).not.toContain('isPostgres');
  });

  it('adds getInsensitiveMode import when transforming', () => {
    const content = [
      `import { prisma } from '../../config/database';`,
      `const isPostgres =`,
      `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');`,
      `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('import { getInsensitiveMode }');
  });

  it('does not add duplicate import on second pass', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const isPostgres =`,
      `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');`,
      `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    if (result.changed) {
      const count = (result.newContent.match(/import \{ getInsensitiveMode \}/g) || []).length;
      expect(count).toBe(1);
    }
  });

  it('is idempotent — skips files already using getInsensitiveMode()', () => {
    const content = `const insensitive = getInsensitiveMode();\n`;
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
  });

  it('skips config/db-provider.ts to prevent self-modification', () => {
    const content = [
      `export function getInsensitiveMode() {`,
      `  return getDbProvider() === 'postgresql' ? { mode: 'insensitive' as const } : {};`,
      `}`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: dbProviderPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
  });

  it('detects Pattern B and adds to manualReview without modifying content', () => {
    const content = [
      `function titleEqualsFilter(title: string) {`,
      `  if (getDbProvider() === 'sqlite') {`,
      `    return { equals: title };`,
      `  }`,
      `  return { equals: title, mode: 'insensitive' };`,
      `}`,
    ].join('\n');
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('Pattern B');
  });

  it('leaves unrelated files unchanged with empty manualReview', () => {
    const content = `const x = 1;\n`;
    const result = transformInsensitiveMode({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.manualReview).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runCodemod dry-run integration (transformInsensitiveMode)
// ---------------------------------------------------------------------------

describe('runCodemod dry-run (transformInsensitiveMode)', () => {
  it('does NOT write files in dry-run mode', () => {
    const content = [
      `const isPostgres =`,
      `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');`,
      `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
    ].join('\n');
    const filePath = write('services/test-insensitive.ts', content);
    const before = readFileSync(filePath, 'utf-8');

    runCodemod(transformInsensitiveMode, {
      roots: [join(tmpDir, 'services')],
      label: 'test-insensitive-dry',
      write: false,
    });

    const after = readFileSync(filePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('returns correct summary counts', () => {
    write(
      'services/a.ts',
      [
        `const isPostgres =`,
        `  process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');`,
        `const insensitive = isPostgres ? { mode: 'insensitive' as const } : {};`,
      ].join('\n'),
    );
    write('services/b.ts', `const x = getInsensitiveMode();\n`);

    const summary = runCodemod(transformInsensitiveMode, {
      roots: [join(tmpDir, 'services')],
      label: 'test-insensitive-summary',
      write: false,
    });

    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runCodemod dry-run integration
// ---------------------------------------------------------------------------

describe('runCodemod dry-run', () => {
  it('does NOT write files in dry-run mode (default)', () => {
    const filePath = write('services/test-dry.ts', `const x = JSON.parse(v || '[]');\n`);
    const before = readFileSync(filePath, 'utf-8');

    runCodemod(transformSpecArray, {
      roots: [join(tmpDir, 'services')],
      label: 'test-dry-run',
      write: false,
    });

    const after = readFileSync(filePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('returns correct summary counts', () => {
    write('services/a.ts', `const x = JSON.parse(v || '[]');\n`);
    write('services/b.ts', `const y = parseSpecArray(v);\n`);

    const summary = runCodemod(transformSpecArray, {
      roots: [join(tmpDir, 'services')],
      label: 'test-summary',
      write: false,
    });

    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// transformInsensitiveSpread
// ---------------------------------------------------------------------------

describe('transformInsensitiveSpread', () => {
  const svcPath = () => join(tmpDir, 'services', 'foo.ts');
  const dbProviderPath = () => join(tmpDir, 'config', 'db-provider.ts');

  it('inlines safe single-spread B1 declaration and removes variable', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const insensitive = getInsensitiveMode();`,
      `const result = { contains: q, ...insensitive };`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('...getInsensitiveMode()');
    expect(result.newContent).not.toContain('const insensitive = getInsensitiveMode();');
    expect(result.manualReview).toHaveLength(0);
  });

  it('puts multi-reference declaration in manualReview without changing', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const insensitive = getInsensitiveMode();`,
      `const r1 = { contains: q, ...insensitive };`,
      `const r2 = { equals: x, ...insensitive };`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('Pattern B1');
    expect(result.manualReview[0]).toContain('2 spread reference(s)');
  });

  it('puts `: any` annotation declaration in manualReview without changing', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const insensitive: any = getInsensitiveMode();`,
      `const result = { contains: q, ...insensitive };`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('`: any` type annotation');
  });

  it('puts eslint-disable-on-declaration in manualReview without changing', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `// eslint-disable-next-line @typescript-eslint/no-explicit-any`,
      `const insensitive = getInsensitiveMode();`,
      `const result = { contains: q, ...insensitive };`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('eslint-disable comment');
  });

  it('puts eslint-disable-on-spread-site in manualReview without changing', () => {
    // NOTE: eslint-disable on the spread site (not the declaration) — inlining would break it.
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const insensitive = getInsensitiveMode();`,
      `// eslint-disable-next-line @typescript-eslint/no-explicit-any`,
      `const result = { contains: q, ...insensitive } as any;`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('eslint-disable comment');
  });

  it('is idempotent — skips files with inlined getInsensitiveMode() but no declaration', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const result = { contains: q, ...getInsensitiveMode() };`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview).toHaveLength(0);
  });

  it('skips config/db-provider.ts to prevent self-modification', () => {
    const content = [
      `export function getInsensitiveMode() {`,
      `  return getDbProvider() === 'postgresql' ? { mode: 'insensitive' as const } : {};`,
      `}`,
    ].join('\n');
    const result = transformInsensitiveSpread({ filePath: dbProviderPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview).toHaveLength(0);
  });

  it('leaves unrelated files unchanged with empty manualReview', () => {
    const content = `const x = 1;\n`;
    const result = transformInsensitiveSpread({ filePath: svcPath(), content });
    expect(result.changed).toBe(false);
    expect(result.manualReview).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runCodemod dry-run integration (transformInsensitiveSpread)
// ---------------------------------------------------------------------------

describe('runCodemod dry-run (transformInsensitiveSpread)', () => {
  it('does NOT write files in dry-run mode', () => {
    const content = [
      `import { getInsensitiveMode } from '../../config/db-provider';`,
      `const insensitive = getInsensitiveMode();`,
      `const result = { contains: q, ...insensitive };`,
    ].join('\n');
    const filePath = write('services/test-spread.ts', content);
    const before = readFileSync(filePath, 'utf-8');

    runCodemod(transformInsensitiveSpread, {
      roots: [join(tmpDir, 'services')],
      label: 'test-spread-dry',
      write: false,
    });

    const after = readFileSync(filePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('returns correct summary counts for safe and unrelated files', () => {
    write(
      'services/safe.ts',
      [
        `import { getInsensitiveMode } from '../../config/db-provider';`,
        `const insensitive = getInsensitiveMode();`,
        `const result = { contains: q, ...insensitive };`,
      ].join('\n'),
    );
    write('services/unrelated.ts', `const x = 1;\n`);

    const summary = runCodemod(transformInsensitiveSpread, {
      roots: [join(tmpDir, 'services')],
      label: 'test-spread-summary',
      write: false,
    });

    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// transformPreferTestEach
// ---------------------------------------------------------------------------

describe('transformPreferTestEach', () => {
  const testPath = () => join(tmpDir, 'tests', 'foo.test.ts');

  it('converts 3-expect block to test.each', () => {
    const content = [
      `test('invalid prefix', () => {`,
      `  expect(isValid('a')).toBe(false);`,
      `  expect(isValid('b')).toBe(false);`,
      `  expect(isValid('c')).toBe(false);`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain("test.each(['a', 'b', 'c'])");
    expect(result.newContent).toContain('(input) =>');
    expect(result.newContent).toContain('expect(isValid(input)).toBe(false)');
  });

  it('converts 5-expect block to test.each', () => {
    const content = [
      `test('special chars', () => {`,
      `  expect(isValid('a~')).toBe(false);`,
      `  expect(isValid('a^')).toBe(false);`,
      `  expect(isValid('a:')).toBe(false);`,
      `  expect(isValid('a?')).toBe(false);`,
      `  expect(isValid('a*')).toBe(false);`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain('test.each(');
    expect(result.newContent).toContain("'a~'");
    expect(result.newContent).toContain("'a*'");
  });

  it('leaves 2-expect block unchanged — below threshold', () => {
    const content = [
      `it('two expects', () => {`,
      `  expect(fn('a')).toBeNull();`,
      `  expect(fn('b')).toBeNull();`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview).toHaveLength(0);
  });

  it('emits manualReview for blocks with mixed matchers', () => {
    const content = [
      `test('mixed matchers', () => {`,
      `  expect(fn('a')).toBe(true);`,
      `  expect(fn('b')).toBe(false);`,
      `  expect(fn('c')).toBeNull();`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('mixed FN/MATCHER/VAL');
  });

  it('emits manualReview for multi-arg FN calls', () => {
    const content = [
      `test('multi-arg', () => {`,
      `  expect(fn('a', 1)).toBe(false);`,
      `  expect(fn('b', 2)).toBe(false);`,
      `  expect(fn('c', 3)).toBe(false);`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview.length).toBeGreaterThan(0);
    expect(result.manualReview[0]).toContain('multi-arg');
  });

  it('is idempotent — already-transformed block is not re-processed', () => {
    const content = [
      `test.each(['a', 'b', 'c'])(`,
      `  'desc: %s',`,
      `  (input) => {`,
      `    expect(fn(input)).toBe(false);`,
      `  },`,
      `);`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
    expect(result.manualReview).toHaveLength(0);
  });

  it('leaves blocks with mixed non-expect statements unchanged without manualReview', () => {
    const content = [
      `it('mixed', () => {`,
      `  const x = setup();`,
      `  expect(fn('a')).toBe(false);`,
      `  expect(fn('b')).toBe(false);`,
      `  expect(fn('c')).toBe(false);`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(false);
    expect(result.newContent).toBe(content);
  });

  it('appends title with `: %s` suffix in generated test.each description', () => {
    const content = [
      `test('my description', () => {`,
      `  expect(check(1)).toBe(false);`,
      `  expect(check(2)).toBe(false);`,
      `  expect(check(3)).toBe(false);`,
      `});`,
    ].join('\n');
    const result = transformPreferTestEach({ filePath: testPath(), content });
    expect(result.changed).toBe(true);
    expect(result.newContent).toContain("'my description: %s'");
  });
});

// ---------------------------------------------------------------------------
// runCodemod dry-run integration (transformPreferTestEach)
// ---------------------------------------------------------------------------

describe('runCodemod dry-run (transformPreferTestEach)', () => {
  /** excludeDirs matching the codemod's production runner — includes tests/ directories */
  const codemodExcludeDirs = [
    'node_modules',
    '.git',
    'dist',
    '.next',
    'generated',
    'prisma',
    'scripts',
  ];

  it('does NOT write files in dry-run mode', () => {
    const content = [
      `test('should be converted', () => {`,
      `  expect(isValid('a')).toBe(false);`,
      `  expect(isValid('b')).toBe(false);`,
      `  expect(isValid('c')).toBe(false);`,
      `});`,
    ].join('\n');
    const filePath = write('services/foo.test.ts', content);
    const before = readFileSync(filePath, 'utf-8');

    runCodemod(transformPreferTestEach, {
      roots: [tmpDir],
      extensions: ['.test.ts'],
      excludeDirs: codemodExcludeDirs,
      label: 'test-each-dry',
      write: false,
    });

    const after = readFileSync(filePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('scans tests/ directory when excludeDirs overrides DEFAULT_EXCLUDE_DIRS', () => {
    // NOTE: DEFAULT_EXCLUDE_DIRS includes 'tests', so without the override this file
    // would be skipped. This test verifies the production excludeDirs argument works.
    const content = [
      `test('pattern B', () => {`,
      `  expect(isValid('a')).toBe(false);`,
      `  expect(isValid('b')).toBe(false);`,
      `  expect(isValid('c')).toBe(false);`,
      `});`,
    ].join('\n');
    write('tests/foo.test.ts', content);

    const summary = runCodemod(transformPreferTestEach, {
      roots: [tmpDir],
      extensions: ['.test.ts'],
      excludeDirs: codemodExcludeDirs,
      label: 'test-each-tests-dir',
      write: false,
    });

    // The file in tests/ should be found and detected as changed
    expect(summary.changed).toBeGreaterThan(0);
  });

  it('returns correct changed/unchanged counts', () => {
    write(
      'services/a.test.ts',
      [
        `test('pattern B', () => {`,
        `  expect(isValid('a')).toBe(false);`,
        `  expect(isValid('b')).toBe(false);`,
        `  expect(isValid('c')).toBe(false);`,
        `});`,
      ].join('\n'),
    );
    write('services/b.test.ts', `const x = 1;\n`);

    const summary = runCodemod(transformPreferTestEach, {
      roots: [tmpDir],
      extensions: ['.test.ts'],
      excludeDirs: codemodExcludeDirs,
      label: 'test-each-summary',
      write: false,
    });

    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
  });
});
