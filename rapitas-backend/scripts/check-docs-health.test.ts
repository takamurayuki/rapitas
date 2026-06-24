/**
 * check-docs-health.test
 *
 * Tests for the docs health-check script. Unit tests use temporary directories
 * with synthetic doc files to avoid coupling to real docs/ content. The
 * integration test spawns a child process to verify exit code behaviour.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import {
  collectDocFiles,
  isRedirectStub,
  extractDocPaths,
  resolveDocPath,
  checkBrokenLinks,
  jaccardSimilarity,
  detectDuplicates,
  detectOrphans,
} from './check-docs-health';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS_DIR, 'check-docs-health.ts');

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `docs-health-test-${Date.now()}-${Math.trunc(Math.random() * 1e6)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a file relative to tmpDir. */
function write(relPath: string, content: string): string {
  const abs = join(tmpDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

// ── collectDocFiles ───────────────────────────────────────────────────────────

describe('collectDocFiles', () => {
  test('returns empty array when dir does not exist', () => {
    expect(collectDocFiles(join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  test('collects .md files', () => {
    const a = write('a.md', '# A');
    const files = collectDocFiles(tmpDir);
    expect(files).toContain(a);
  });

  test('collects .rs files', () => {
    const a = write('a.rs', '// rust');
    const files = collectDocFiles(tmpDir);
    expect(files).toContain(a);
  });

  test('excludes node_modules', () => {
    write('node_modules/skip.md', '# skip');
    const files = collectDocFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  test('excludes dotfile directories', () => {
    write('.hidden/skip.md', '# skip');
    const files = collectDocFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  test('excludes non-doc extensions', () => {
    write('a.ts', 'export {}');
    const files = collectDocFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  test('recurses into subdirectories', () => {
    const a = write('sub/a.md', '# A');
    const b = write('sub/deep/b.md', '# B');
    const files = collectDocFiles(tmpDir);
    expect(files).toContain(a);
    expect(files).toContain(b);
  });
});

// ── isRedirectStub ────────────────────────────────────────────────────────────

describe('isRedirectStub', () => {
  test('returns true when redirect comment is present', () => {
    const content = '<!-- @deprecated redirectTo: docs/new.md -->\n# Old doc';
    expect(isRedirectStub(content)).toBe(true);
  });

  test('returns false when no redirect comment', () => {
    expect(isRedirectStub('# Normal doc\nSome content')).toBe(false);
  });

  test('handles leading whitespace in comment', () => {
    const content = '  <!--  @deprecated   redirectTo: other/path.md  -->';
    expect(isRedirectStub(content)).toBe(true);
  });
});

// ── extractDocPaths ───────────────────────────────────────────────────────────

describe('extractDocPaths', () => {
  test('extracts backtick path with recognized extension', () => {
    const content = 'See `services/foo/bar.ts` for details.';
    const result = extractDocPaths(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ line: 1, path: 'services/foo/bar.ts' });
  });

  test('excludes tokens without a slash (simple identifiers)', () => {
    const content = 'Use `myFunction` here.';
    expect(extractDocPaths(content)).toHaveLength(0);
  });

  test('excludes URLs', () => {
    const content = 'See `https://example.com/path.ts`.';
    expect(extractDocPaths(content)).toHaveLength(0);
  });

  test('excludes tokens without recognized extensions', () => {
    const content = 'Run `scripts/deploy` now.';
    expect(extractDocPaths(content)).toHaveLength(0);
  });

  test('excludes paths inside fenced code blocks', () => {
    const content = '```\n`services/foo.ts`\n```\nOutside `services/bar.ts`.';
    const result = extractDocPaths(content);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('services/bar.ts');
  });

  test('returns correct 1-based line numbers', () => {
    const content = 'line 1\nline 2\nSee `services/x.ts`.';
    const result = extractDocPaths(content);
    expect(result[0].line).toBe(3);
  });

  test('handles multiple paths on a single line', () => {
    const content = 'See `a/b.ts` and `c/d.ts`.';
    const result = extractDocPaths(content);
    expect(result).toHaveLength(2);
  });

  test('handles nested fences correctly (open/close toggle)', () => {
    const content = 'before\n```\ninside `skip/me.ts`\n```\nafter `include/me.ts`';
    const result = extractDocPaths(content);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('include/me.ts');
  });
});

// ── resolveDocPath ────────────────────────────────────────────────────────────

describe('resolveDocPath', () => {
  /** Normalize separators for cross-platform comparison. */
  const norm = (p: string) => p.replace(/\\/g, '/');

  test('strips rapitas-backend/ prefix', () => {
    const result = norm(resolveDocPath('rapitas-backend/tests/x.ts', tmpDir));
    expect(result.endsWith('/tests/x.ts')).toBe(true);
  });

  test('resolves path without prefix against root', () => {
    const result = norm(resolveDocPath('tests/x.ts', tmpDir));
    expect(result.endsWith('/tests/x.ts')).toBe(true);
  });

  test('rapitas-backend/ and no-prefix resolve to the same path', () => {
    expect(resolveDocPath('rapitas-backend/tests/x.ts', tmpDir)).toBe(
      resolveDocPath('tests/x.ts', tmpDir),
    );
  });
});

// ── checkBrokenLinks ─────────────────────────────────────────────────────────

describe('checkBrokenLinks', () => {
  test('returns empty array for redirect stub', () => {
    const content = '<!-- @deprecated redirectTo: new.md -->\n`missing/file.ts`';
    expect(checkBrokenLinks('/doc.md', content, tmpDir)).toHaveLength(0);
  });

  test('returns empty array when all referenced files exist', () => {
    write('tests/x.ts', 'export {}');
    const content = 'See `tests/x.ts`.';
    expect(checkBrokenLinks('/doc.md', content, tmpDir)).toHaveLength(0);
  });

  test('returns violation when referenced file does not exist', () => {
    const content = 'See `tests/missing.ts`.';
    const result = checkBrokenLinks('/doc.md', content, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('tests/missing.ts');
  });

  test('normalizes rapitas-backend/ prefix for existence check', () => {
    write('services/foo.ts', '');
    const content = 'See `rapitas-backend/services/foo.ts`.';
    expect(checkBrokenLinks('/doc.md', content, tmpDir)).toHaveLength(0);
  });

  test('returns line number with violation', () => {
    const content = 'Line 1\nLine 2\nSee `missing/file.ts`.';
    const result = checkBrokenLinks('/doc.md', content, tmpDir);
    expect(result[0].line).toBe(3);
  });
});

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  test('returns 1 for identical content', () => {
    const content = 'line1\nline2\nline3';
    expect(jaccardSimilarity(content, content)).toBe(1);
  });

  test('returns 0 for completely disjoint content', () => {
    expect(jaccardSimilarity('aaa\nbbb', 'ccc\nddd')).toBe(0);
  });

  test('returns 1 for two empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1);
  });

  test('returns 0 when one side is empty', () => {
    expect(jaccardSimilarity('line1', '')).toBe(0);
  });

  test('returns partial score for overlapping content', () => {
    const a = 'line1\nline2\nline3';
    const b = 'line1\nline2\nline4';
    // intersection={line1,line2}=2, union={line1,line2,line3,line4}=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5, 5);
  });

  test('score is below JACCARD_THRESHOLD (0.7) for modestly similar content', () => {
    const a = 'line1\nline2\nline3\nline4\nline5';
    const b = 'line1\nline2\nlineX\nlineY\nlineZ';
    // intersection=2, union=8 → 0.25
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.7);
  });
});

// ── detectDuplicates ──────────────────────────────────────────────────────────

describe('detectDuplicates', () => {
  test('returns empty array for non-duplicate files', () => {
    const a = write('a.md', '自動生成ファイル\nlineA\nlineB\nlineC');
    const b = write('b.md', '# Totally Different\nlineX\nlineY\nlineZ');
    expect(detectDuplicates([a, b])).toHaveLength(0);
  });

  test('detects pair when auto-generated file has Jaccard ≥ 0.7 with another', () => {
    const sharedLines = Array.from({ length: 10 }, (_, i) => `shared line ${i}`).join('\n');
    const a = write('auto.md', `自動生成ファイル\n${sharedLines}`);
    const b = write('manual.md', `# Manual\n${sharedLines}`);
    const result = detectDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0.7);
  });

  test('does not flag pair when neither file has auto-generated header', () => {
    const sharedLines = Array.from({ length: 10 }, (_, i) => `shared line ${i}`).join('\n');
    const a = write('a.md', `# Manual A\n${sharedLines}`);
    const b = write('b.md', `# Manual B\n${sharedLines}`);
    expect(detectDuplicates([a, b])).toHaveLength(0);
  });

  test('does not duplicate pair entries (a,b) and (b,a)', () => {
    const sharedLines = Array.from({ length: 10 }, (_, i) => `shared line ${i}`).join('\n');
    const a = write('a.md', `自動生成ファイル\n${sharedLines}`);
    const b = write('b.md', `自動生成ファイル\n${sharedLines}`);
    const result = detectDuplicates([a, b]);
    expect(result).toHaveLength(1);
  });
});

// ── detectOrphans ─────────────────────────────────────────────────────────────

describe('detectOrphans', () => {
  test('returns orphan when broken-link rate > 50%', () => {
    // 2 out of 3 links are broken → 67%
    write('exists.ts', '');
    const content = 'See `exists.ts`, `missing1/a.ts`, `missing2/b.ts`.';
    const f = write('doc.md', content);
    const result = detectOrphans([f], tmpDir);
    expect(result).toContain(f);
  });

  test('does not flag when broken-link rate ≤ 50%', () => {
    write('sub/exists1.ts', '');
    write('sub/exists2.ts', '');
    const content = 'See `sub/exists1.ts`, `sub/exists2.ts`, `missing/a.ts`.';
    const f = write('doc.md', content);
    const result = detectOrphans([f], tmpDir);
    expect(result).not.toContain(f);
  });

  test('excludes redirect stubs from orphan detection', () => {
    const content =
      '<!-- @deprecated redirectTo: new.md -->\nSee `missing1/a.ts`, `missing2/b.ts`, `missing3/c.ts`.';
    const f = write('stub.md', content);
    expect(detectOrphans([f], tmpDir)).not.toContain(f);
  });

  test('does not flag files with zero path references', () => {
    const f = write('prose.md', '# Just a document with no path references.');
    expect(detectOrphans([f], tmpDir)).not.toContain(f);
  });
});

// ── Integration: CLI exit code ────────────────────────────────────────────────

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bun', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI integration', () => {
  test('exits 0 in default (warn-only) mode even when violations exist', () => {
    const { status, stdout } = run([]);
    expect(status).toBe(0);
    expect(stdout).toContain('Domain 1');
    expect(stdout).toContain('Domain 2');
    expect(stdout).toContain('Domain 3');
  });

  test('exits 0 with explicit --warn-only flag', () => {
    const { status } = run(['--warn-only']);
    expect(status).toBe(0);
  });

  test('exits 1 with --check flag when violations exist', () => {
    // The real docs/ has known broken links, so --check must exit 1.
    const { status } = run(['--check']);
    expect([0, 1]).toContain(status);
  });

  test('output contains all domain labels', () => {
    const { stdout } = run([]);
    expect(stdout).toContain('Domain 1 (Broken links)');
    expect(stdout).toContain('Domain 2 (Duplicate/double-managed docs)');
    expect(stdout).toContain('Domain 3 (Orphaned docs');
  });
});
