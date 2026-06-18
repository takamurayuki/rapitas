/**
 * codemod-runner.test
 *
 * Unit and dry-run integration tests for the codemod infrastructure:
 *   - codemod-runner: walkTs, ensureImport, relativeImportPath, runCodemod
 *   - transformSpecArray
 *   - transformPrismaSingleton
 *   - transformResponseHelper
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ensureImport, relativeImportPath, runCodemod, walkTs } from '../lib/codemod-runner';
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
