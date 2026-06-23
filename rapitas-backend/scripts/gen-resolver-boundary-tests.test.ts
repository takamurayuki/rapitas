/**
 * gen-resolver-boundary-tests.test
 *
 * Unit tests for the boundary-value test scaffolding generator.
 * Covers every exported function at ≥80% branch coverage.
 */

import { describe, test, expect } from 'bun:test';
import {
  hasResolverCandidate,
  extractDbImportPath,
  detectNonStandardImports,
  extractResolverFunctions,
  extractModelUsage,
  generateBoundaryTestSource,
  parseFilesArg,
  checkDrift,
  type ExtractedFunction,
  type ModelUsage,
} from './gen-resolver-boundary-tests';

// ---------------------------------------------------------------------------
// hasResolverCandidate
// ---------------------------------------------------------------------------
describe('hasResolverCandidate', () => {
  test('returns true when both markers are present', () => {
    const content = `import { prisma } from '../config/database';\nexport async function resolveTask(id: number) {}`;
    expect(hasResolverCandidate(content)).toBe(true);
  });

  test('returns false when prisma import is absent', () => {
    const content = `export async function resolveTask(id: number) {}`;
    expect(hasResolverCandidate(content)).toBe(false);
  });

  test('returns false when resolve function is absent', () => {
    const content = `import { prisma } from '../config/database';`;
    expect(hasResolverCandidate(content)).toBe(false);
  });

  test('returns false when both markers are absent', () => {
    expect(hasResolverCandidate('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractDbImportPath
// ---------------------------------------------------------------------------
describe('extractDbImportPath', () => {
  test('extracts path from double-quoted import', () => {
    const content = `import { prisma } from "../../config/database";`;
    expect(extractDbImportPath(content)).toBe('../../config/database');
  });

  test('extracts path from single-quoted import', () => {
    const content = `import { prisma, ensureDatabaseConnection } from '../config/database';`;
    expect(extractDbImportPath(content)).toBe('../config/database');
  });

  test('returns null when no prisma import exists', () => {
    expect(extractDbImportPath(`import { something } from 'elsewhere';`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectNonStandardImports
// ---------------------------------------------------------------------------
describe('detectNonStandardImports', () => {
  test('returns empty array for allowed imports only', () => {
    const content = [
      `import type { Task } from '@prisma/client';`,
      `import { prisma } from '../../config/database';`,
      `import { createLogger } from '../../config/logger';`,
    ].join('\n');
    expect(detectNonStandardImports(content)).toEqual([]);
  });

  test('detects non-standard value imports', () => {
    const content = `import { ghClient } from './gh-client';`;
    expect(detectNonStandardImports(content)).toContain('./gh-client');
  });

  test('ignores type-only imports', () => {
    const content = `import type { Foo } from './some-module';`;
    expect(detectNonStandardImports(content)).toEqual([]);
  });

  test('returns multiple non-standard paths', () => {
    const content = [`import { a } from './mod-a';`, `import { b } from './mod-b';`].join('\n');
    const result = detectNonStandardImports(content);
    expect(result).toContain('./mod-a');
    expect(result).toContain('./mod-b');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractResolverFunctions
// ---------------------------------------------------------------------------
describe('extractResolverFunctions', () => {
  test('extracts a single number param function', () => {
    const content = `export async function resolveTask(taskId: number) { return null; }`;
    const { functions, manualReview } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      name: 'resolveTask',
      paramName: 'taskId',
      paramType: 'number',
    });
    expect(manualReview).toHaveLength(0);
  });

  test('extracts a single string param function', () => {
    const content = `export async function resolveUser(email: string) { return null; }`;
    const { functions } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions[0]).toMatchObject({
      name: 'resolveUser',
      paramName: 'email',
      paramType: 'string',
    });
  });

  test('extracts a number | null param function', () => {
    const content = `export async function resolveItem(linkedId: number | null) { return null; }`;
    const { functions } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions[0]).toMatchObject({ paramType: 'number | null' });
  });

  test('flags multi-arg functions in manualReview', () => {
    const content = `export async function resolveByEmailAndId(email: string, id: number) { return null; }`;
    const { functions, manualReview } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(0);
    expect(manualReview[0]).toContain('resolveByEmailAndId');
    expect(manualReview[0]).toContain('2 params');
  });

  test('flags zero-arg functions in manualReview', () => {
    const content = `export async function resolveDefault() { return null; }`;
    const { functions, manualReview } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(0);
    expect(manualReview[0]).toContain('0 params');
  });

  test('flags unsupported param types in manualReview', () => {
    const content = `export async function resolveById(id: string | number) { return null; }`;
    const { functions, manualReview } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(0);
    expect(manualReview[0]).toContain('unsupported param type');
  });

  test('handles multi-line function signatures (trailing comma)', () => {
    const content = [
      'export async function resolveTaskForExecution(',
      '  taskId: number,',
      ') {',
      '  return null;',
      '}',
    ].join('\n');
    const { functions } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      name: 'resolveTaskForExecution',
      paramName: 'taskId',
      paramType: 'number',
    });
  });

  test('extracts multiple functions from the same file', () => {
    const content = [
      `export async function resolveTaskA(id: number) {}`,
      `export async function resolveTaskB(name: string) {}`,
    ].join('\n');
    const { functions } = extractResolverFunctions('/fake/path.ts', content);
    expect(functions).toHaveLength(2);
    expect(functions.map((f) => f.name)).toEqual(['resolveTaskA', 'resolveTaskB']);
  });
});

// ---------------------------------------------------------------------------
// extractModelUsage
// ---------------------------------------------------------------------------
describe('extractModelUsage', () => {
  test('extracts single-line prisma call', () => {
    const content = `return prisma.task.findUnique({ where: { id } }).catch(() => null);`;
    const models = extractModelUsage(content);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelName: 'task', methods: ['findUnique'] });
  });

  test('extracts multi-line prisma call', () => {
    // NOTE: This is the real format used in task-resolver.ts — the regex must handle whitespace.
    const content = [
      'return prisma.task',
      '  .findUnique({ where: { id } })',
      '  .catch(() => null);',
    ].join('\n');
    const models = extractModelUsage(content);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelName: 'task', methods: ['findUnique'] });
  });

  test('deduplicates same model+method used multiple times', () => {
    const content = [
      `return prisma.task.findUnique({ where: { id: a } }).catch(() => null);`,
      `return prisma.task.findUnique({ where: { id: b } }).catch(() => null);`,
    ].join('\n');
    const models = extractModelUsage(content);
    expect(models).toHaveLength(1);
    expect(models[0].methods).toEqual(['findUnique']);
  });

  test('collects multiple methods for the same model', () => {
    const content = [
      `return prisma.session.findFirst({ where: { token } }).catch(() => null);`,
      `return prisma.session.findUnique({ where: { id } }).catch(() => null);`,
    ].join('\n');
    const models = extractModelUsage(content);
    expect(models).toHaveLength(1);
    expect(models[0].methods.sort()).toEqual(['findFirst', 'findUnique']);
  });

  test('collects multiple models', () => {
    const content = [
      `return prisma.task.findUnique({ where: { id } }).catch(() => null);`,
      `return prisma.user.findFirst({ where: { email } }).catch(() => null);`,
    ].join('\n');
    const models = extractModelUsage(content);
    expect(models).toHaveLength(2);
    const names = models.map((m) => m.modelName).sort();
    expect(names).toEqual(['task', 'user']);
  });

  test('returns empty array when no prisma calls are found', () => {
    expect(extractModelUsage(`const x = 1;`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateBoundaryTestSource
// ---------------------------------------------------------------------------
describe('generateBoundaryTestSource', () => {
  const SOURCE = '/app/services/task/task-resolver.ts';
  const OUTPUT = '/app/services/task/task-resolver.boundary.test.ts';
  const DB_IMPORT = '../../config/database';

  const NUMBER_FN: ExtractedFunction = {
    name: 'resolveTask',
    paramName: 'id',
    paramType: 'number',
  };
  const STRING_FN: ExtractedFunction = {
    name: 'resolveUser',
    paramName: 'email',
    paramType: 'string',
  };
  const NULLABLE_FN: ExtractedFunction = {
    name: 'resolveItem',
    paramName: 'linkedId',
    paramType: 'number | null',
  };
  const TASK_MODEL: ModelUsage = { modelName: 'task', methods: ['findUnique'] };

  test('generates a valid TypeScript file header', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('task-resolver.boundary.test');
    expect(src).toContain('自動生成ファイル');
    expect(src).toContain("import { describe, test, expect, mock, beforeEach } from 'bun:test'");
  });

  test('imports ID_EDGES for number params', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('ID_EDGES');
    expect(src).not.toContain('STRING_EDGES');
  });

  test('imports STRING_EDGES for string params', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [STRING_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('STRING_EDGES');
    expect(src).not.toContain('ID_EDGES');
  });

  test('imports NULLABLE_ID_EDGES for number | null params', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NULLABLE_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('NULLABLE_ID_EDGES');
  });

  test('imports multiple edge constants when functions have different param types', () => {
    const src = generateBoundaryTestSource(
      SOURCE,
      OUTPUT,
      [NUMBER_FN, STRING_FN],
      [TASK_MODEL],
      DB_IMPORT,
    );
    expect(src).toContain('ID_EDGES');
    expect(src).toContain('STRING_EDGES');
  });

  test('generates mock variable declaration', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('const mockTaskFindUnique = mock(() => Promise.resolve(null))');
  });

  test('generates mock.module with correct db path', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain(`mock.module('${DB_IMPORT}'`);
    expect(src).toContain('task: { findUnique: mockTaskFindUnique }');
  });

  test('generates empty prisma shape when no models detected', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [], DB_IMPORT);
    expect(src).toContain('prisma: {},');
  });

  test('generates beforeEach with mock resets', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('mockTaskFindUnique.mockReset()');
    expect(src).toContain('mockTaskFindUnique.mockResolvedValue(null)');
  });

  test('generates test.each with rejection setup', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('mockTaskFindUnique.mockRejectedValueOnce(new Error');
  });

  test('includes the HACK comment exactly once', () => {
    const src = generateBoundaryTestSource(
      SOURCE,
      OUTPUT,
      [NUMBER_FN, NULLABLE_FN],
      [TASK_MODEL],
      DB_IMPORT,
    );
    const occurrences = (src.match(/HACK\(agent\)/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  test('generates logger mock', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NUMBER_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('createLogger');
    expect(src).toContain('noopLogger');
  });

  test('casts parameter correctly for number | null type', () => {
    const src = generateBoundaryTestSource(SOURCE, OUTPUT, [NULLABLE_FN], [TASK_MODEL], DB_IMPORT);
    expect(src).toContain('edge as number | null');
    expect(src).toContain('as (number | null)[]');
    expect(src).toContain('NULLABLE_ID_EDGES.map((bc) => bc.value)');
  });

  test('generates one describe block per function', () => {
    const src = generateBoundaryTestSource(
      SOURCE,
      OUTPUT,
      [NUMBER_FN, STRING_FN],
      [TASK_MODEL],
      DB_IMPORT,
    );
    const describeCount = (src.match(/^describe\(/gm) ?? []).length;
    expect(describeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseFilesArg
// ---------------------------------------------------------------------------
describe('parseFilesArg', () => {
  test('returns null when no --files flag is present', () => {
    expect(parseFilesArg(['node', 'script.ts', '--check'])).toBeNull();
  });

  test('parses --files=a.ts,b.ts', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files=a.ts,b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('parses --files= with empty value', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files=']);
    expect(result).toEqual([]);
  });

  test('parses --files followed by positional arguments', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', 'b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('stops collecting files at the next flag', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', '--check']);
    expect(result).toEqual(['a.ts']);
  });
});

// ---------------------------------------------------------------------------
// checkDrift (integration: runs against real generated files)
// ---------------------------------------------------------------------------
describe('checkDrift', () => {
  test('reports no drift after generator run', () => {
    // All 4 generated files were just regenerated; drift must be zero.
    const drifts = checkDrift();
    const driftPaths = drifts.map((d) => d.file);
    expect(driftPaths).toEqual([]);
  });
});
