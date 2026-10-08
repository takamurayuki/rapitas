/**
 * scaffold-project-writer.test
 *
 * Every path here originates in a model's JSON output, so the rejection rules
 * are the security boundary and are tested against a real temp directory —
 * a mocked fs would not prove that nothing lands outside the project.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MAX_SCAFFOLD_FILES,
  MAX_SCAFFOLD_FILE_BYTES,
  rejectScaffoldPath,
  writeProjectSkeleton,
} from './scaffold-project-writer';

let base: string;
let projectPath: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'skeleton-'));
  projectPath = path.join(base, 'myapp');
  fs.mkdirSync(projectPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const read = (rel: string) => fs.readFileSync(path.join(projectPath, rel), 'utf8');

describe('rejectScaffoldPath', () => {
  it('accepts ordinary project-relative paths', () => {
    for (const p of [
      'package.json',
      'tsconfig.base.json',
      'apps/web/package.json',
      'packages/core/src/index.ts',
      '.gitignore',
      '.env.example',
    ]) {
      expect(rejectScaffoldPath(p)).toBeNull();
    }
  });

  it('refuses anything that escapes the project', () => {
    const cases: Record<string, string> = {
      '/etc/passwd': 'absolute path',
      'C:/Windows/system32/x.dll': 'drive-qualified path',
      '../outside.txt': 'parent traversal',
      'apps/../../outside.txt': 'parent traversal',
      // Backslashes are normalized first, so this is traversal, not a name.
      '..\\outside.txt': 'parent traversal',
      './x.txt': 'empty path segment',
      'apps//web/x.ts': 'empty path segment',
    };
    for (const [input, reason] of Object.entries(cases)) {
      expect(rejectScaffoldPath(input)).toBe(reason);
    }
  });

  it('refuses the paths the other writers own', () => {
    // Overwriting these would silently discard the generated specs or the guide.
    expect(rejectScaffoldPath('docs/design.md')).toBe('reserved directory');
    expect(rejectScaffoldPath('.claude/CLAUDE.md')).toBe('reserved directory');
    expect(rejectScaffoldPath('.git/config')).toBe('reserved directory');
    expect(rejectScaffoldPath('node_modules/zod/index.js')).toBe('reserved directory');
    expect(rejectScaffoldPath('AGENTS.md')).toBe('reserved file');
  });

  it('refuses non-strings, blanks and illegal characters', () => {
    expect(rejectScaffoldPath(undefined)).toBe('empty path');
    expect(rejectScaffoldPath('')).toBe('empty path');
    expect(rejectScaffoldPath('   ')).toBe('empty path');
    expect(rejectScaffoldPath(42)).toBe('empty path');
    expect(rejectScaffoldPath('a<b.ts')).toBe('illegal character');
    expect(rejectScaffoldPath(`${'x'.repeat(201)}.ts`)).toBe('path too long');
  });
});

describe('writeProjectSkeleton', () => {
  it('writes a nested skeleton and reports what landed', () => {
    const result = writeProjectSkeleton(projectPath, [
      { path: 'package.json', content: '{"name":"myapp"}' },
      { path: 'pnpm-workspace.yaml', content: "packages:\n  - 'apps/*'\n" },
      { path: 'apps/web/src/main.ts', content: 'export {};\n' },
    ]);

    expect(result.written).toEqual(['package.json', 'pnpm-workspace.yaml', 'apps/web/src/main.ts']);
    expect(result.rejected).toEqual({});
    expect(read('package.json')).toBe('{"name":"myapp"}');
    expect(read('apps/web/src/main.ts')).toBe('export {};\n');
  });

  it('lands the good files and reports the bad ones', () => {
    // One bad path must not cost the whole skeleton.
    const result = writeProjectSkeleton(projectPath, [
      { path: 'package.json', content: '{}' },
      { path: '../escape.txt', content: 'nope' },
      { path: 'docs/design.md', content: 'overwrite attempt' },
    ]);

    expect(result.written).toEqual(['package.json']);
    expect(result.rejected['../escape.txt']).toBe('parent traversal');
    expect(result.rejected['docs/design.md']).toBe('reserved directory');
    expect(fs.existsSync(path.join(base, 'escape.txt'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'docs'))).toBe(false);
  });

  it('refuses a duplicate path rather than writing it twice', () => {
    const result = writeProjectSkeleton(projectPath, [
      { path: 'package.json', content: 'first' },
      { path: 'package.json', content: 'second' },
    ]);
    expect(result.written).toEqual(['package.json']);
    expect(result.rejected['package.json']).toBe('duplicate path');
    expect(read('package.json')).toBe('first');
  });

  it('normalizes a backslash path to the same entry', () => {
    const result = writeProjectSkeleton(projectPath, [
      { path: 'apps\\web\\package.json', content: '{}' },
    ]);
    expect(result.written).toEqual(['apps/web/package.json']);
    expect(read('apps/web/package.json')).toBe('{}');
  });

  it('refuses an oversized file', () => {
    const result = writeProjectSkeleton(projectPath, [
      { path: 'big.ts', content: 'x'.repeat(MAX_SCAFFOLD_FILE_BYTES + 1) },
    ]);
    expect(result.written).toEqual([]);
    expect(result.rejected['big.ts']).toContain('exceeds');
  });

  it('caps the file count and says so', () => {
    const files = Array.from({ length: MAX_SCAFFOLD_FILES + 5 }, (_, i) => ({
      path: `f${i}.ts`,
      content: 'export {};',
    }));
    const result = writeProjectSkeleton(projectPath, files);
    expect(result.written.length).toBe(MAX_SCAFFOLD_FILES);
    expect(result.rejected['<overflow>']).toContain(String(MAX_SCAFFOLD_FILES));
  });

  it('refuses content that is not a string', () => {
    const result = writeProjectSkeleton(projectPath, [
      { path: 'a.ts', content: 42 as unknown as string },
    ]);
    expect(result.rejected['a.ts']).toBe('content is not a string');
  });

  it('does nothing when no skeleton was generated', () => {
    expect(writeProjectSkeleton(projectPath, undefined).written).toEqual([]);
    expect(writeProjectSkeleton(projectPath, []).written).toEqual([]);
    expect(fs.readdirSync(projectPath)).toEqual([]);
  });
});
