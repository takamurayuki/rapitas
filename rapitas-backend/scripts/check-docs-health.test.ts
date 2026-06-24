/**
 * check-docs-health.test
 *
 * Unit and integration tests for the docs health-check script.
 *
 * Unit tests use temporary directories with dummy docs to avoid coupling to
 * the real docs/ content. The single integration test runs the script as a
 * child process and checks exit-code behaviour only.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

import {
  collectDocFiles,
  isRedirectStub,
  extractDocPaths,
  resolveDocPath,
  checkBrokenLinks,
  jaccardSimilarity,
  detectDuplicates,
  detectOrphans,
  parsePhase,
  runPhase1,
  runPhase2,
} from './check-docs-health';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS_DIR, 'check-docs-health.ts');

// ── Test helpers ──────────────────────────────────────────────────────────────

let tmpRoot: string;

function setup() {
  tmpRoot = join(tmpdir(), `check-docs-health-test-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
}

function teardown() {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/** Write a file under tmpRoot. Parent directories are created automatically. */
function writeFile(relativePath: string, content: string): string {
  const full = join(tmpRoot, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

function runScript(args: string[]): { status: number; stdout: string; stderr: string } {
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

// ── collectDocFiles ───────────────────────────────────────────────────────────

describe('collectDocFiles', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns empty array when directory does not exist', () => {
    expect(collectDocFiles(join(tmpRoot, 'nonexistent'))).toEqual([]);
  });

  test('collects .md and .rs files recursively', () => {
    writeFile('docs/a.md', '# A');
    writeFile('docs/sub/b.md', '# B');
    writeFile('docs/c.rs', '// C');
    writeFile('docs/ignored.txt', 'txt');

    const files = collectDocFiles(join(tmpRoot, 'docs'));
    const names = files.map((f) => f.replace(/\\/g, '/').split('/').pop()!);
    expect(names).toContain('a.md');
    expect(names).toContain('b.md');
    expect(names).toContain('c.rs');
    expect(names).not.toContain('ignored.txt');
  });

  test('excludes node_modules and dotfile directories', () => {
    writeFile('docs/good.md', '# Good');
    writeFile('docs/node_modules/bad.md', '# Bad');
    writeFile('docs/.hidden/bad.md', '# Hidden');

    const files = collectDocFiles(join(tmpRoot, 'docs'));
    const names = files.map((f) => f.replace(/\\/g, '/').split('/').pop()!);
    expect(names).toEqual(['good.md']);
  });

  test('returns sorted paths', () => {
    writeFile('docs/z.md', '# Z');
    writeFile('docs/a.md', '# A');
    writeFile('docs/m.md', '# M');

    const files = collectDocFiles(join(tmpRoot, 'docs'));
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});

// ── isRedirectStub ────────────────────────────────────────────────────────────

describe('isRedirectStub', () => {
  test('returns true for redirect stub with deprecation comment', () => {
    expect(isRedirectStub('<!-- @deprecated redirectTo: docs/new-path.md -->')).toBe(true);
  });

  test('returns true with extra whitespace in comment', () => {
    expect(isRedirectStub('<!--  @deprecated  redirectTo:  docs/other.md  -->')).toBe(true);
  });

  test('returns false for normal document content', () => {
    expect(isRedirectStub('# Normal doc\n\nSome content')).toBe(false);
  });

  test('returns false for incomplete redirect comment', () => {
    expect(isRedirectStub('<!-- @deprecated -->')).toBe(false);
  });
});

// ── extractDocPaths ───────────────────────────────────────────────────────────

describe('extractDocPaths', () => {
  test('extracts backtick path with slash and extension', () => {
    const result = extractDocPaths('See `services/foo.ts` for details.');
    expect(result).toEqual([{ line: 1, path: 'services/foo.ts' }]);
  });

  test('excludes tokens inside code fence blocks', () => {
    const content = [
      'Outside: `services/real.ts`',
      '```ts',
      'Inside fence: `services/fake.ts`',
      '```',
      'After fence: `routes/actual.ts`',
    ].join('\n');
    const result = extractDocPaths(content);
    const paths = result.map((r) => r.path);
    expect(paths).toContain('services/real.ts');
    expect(paths).toContain('routes/actual.ts');
    expect(paths).not.toContain('services/fake.ts');
  });

  test('excludes external URLs', () => {
    const result = extractDocPaths('See `https://example.com/path.ts` for info.');
    expect(result).toHaveLength(0);
  });

  test('excludes tokens without a slash', () => {
    const result = extractDocPaths('Use `filename.ts` here.');
    expect(result).toHaveLength(0);
  });

  test('excludes tokens without a recognized extension', () => {
    const result = extractDocPaths('See `some/path` for details.');
    expect(result).toHaveLength(0);
  });

  test('returns correct 1-indexed line numbers', () => {
    const content = ['line 1', 'line 2 with `services/foo.ts`', 'line 3 with `routes/bar.ts`'].join(
      '\n',
    );
    const result = extractDocPaths(content);
    expect(result).toEqual([
      { line: 2, path: 'services/foo.ts' },
      { line: 3, path: 'routes/bar.ts' },
    ]);
  });

  test('extracts multiple paths from the same line', () => {
    const result = extractDocPaths('Both `services/a.ts` and `routes/b.ts` are relevant.');
    expect(result).toHaveLength(2);
  });

  test('handles .rs, .md, .json extensions', () => {
    const content = '`docs/spec.md` and `src/lib.rs` and `config.json`';
    const result = extractDocPaths(content);
    const exts = result.map((r) => r.path.split('.').pop());
    expect(exts).toContain('md');
    expect(exts).toContain('rs');
    // config.json has no slash so it should be excluded
    expect(result.find((r) => r.path === 'config.json')).toBeUndefined();
  });

  test('handles path with rapitas-backend/ prefix correctly', () => {
    const result = extractDocPaths('See `rapitas-backend/services/foo.ts` for reference.');
    expect(result).toEqual([{ line: 1, path: 'rapitas-backend/services/foo.ts' }]);
  });
});

// ── resolveDocPath ────────────────────────────────────────────────────────────

describe('resolveDocPath', () => {
  test('strips rapitas-backend/ prefix and joins with root', () => {
    const root = '/fake/rapitas-backend';
    const result = resolveDocPath('rapitas-backend/services/foo.ts', root);
    expect(result.replace(/\\/g, '/')).toBe('/fake/rapitas-backend/services/foo.ts');
  });

  test('resolves path without prefix relative to root', () => {
    const root = '/fake/rapitas-backend';
    const result = resolveDocPath('services/foo.ts', root);
    expect(result.replace(/\\/g, '/')).toBe('/fake/rapitas-backend/services/foo.ts');
  });

  test('rapitas-backend/ and no-prefix produce the same absolute path', () => {
    const root = '/fake/rapitas-backend';
    const withPrefix = resolveDocPath('rapitas-backend/tests/x.ts', root);
    const withoutPrefix = resolveDocPath('tests/x.ts', root);
    expect(withPrefix).toBe(withoutPrefix);
  });
});

// ── checkBrokenLinks ──────────────────────────────────────────────────────────

describe('checkBrokenLinks', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns empty array for redirect stub', () => {
    const content = '<!-- @deprecated redirectTo: docs/new.md -->\n`services/gone.ts`';
    expect(checkBrokenLinks('doc.md', content, tmpRoot)).toEqual([]);
  });

  test('returns broken reference for non-existent file', () => {
    const content = 'See `services/missing.ts` for details.';
    const result = checkBrokenLinks('doc.md', content, tmpRoot);
    expect(result).toEqual([{ line: 1, path: 'services/missing.ts' }]);
  });

  test('returns empty array when referenced file exists', () => {
    writeFile('services/existing.ts', 'export const x = 1;');
    const content = 'See `services/existing.ts` for details.';
    const result = checkBrokenLinks('doc.md', content, tmpRoot);
    expect(result).toEqual([]);
  });

  test('normalizes rapitas-backend/ prefix when checking existence', () => {
    writeFile('tests/helpers/values.ts', 'export const x = 1;');
    const content = 'Source: `rapitas-backend/tests/helpers/values.ts`';
    const result = checkBrokenLinks('doc.md', content, tmpRoot);
    expect(result).toEqual([]);
  });

  test('reports broken but not healthy references', () => {
    writeFile('services/good.ts', 'export {};');
    const content = ['`services/good.ts` — exists', '`services/bad.ts` — missing'].join('\n');
    const result = checkBrokenLinks('doc.md', content, tmpRoot);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('services/bad.ts');
    expect(result[0].line).toBe(2);
  });
});

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  test('returns 1 for identical content', () => {
    const content = 'line one\nline two\nline three';
    expect(jaccardSimilarity(content, content)).toBe(1);
  });

  test('returns 1 for two empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1);
  });

  test('returns 0 when one side is empty', () => {
    expect(jaccardSimilarity('some content', '')).toBe(0);
    expect(jaccardSimilarity('', 'some content')).toBe(0);
  });

  test('returns 0 for completely different content', () => {
    const score = jaccardSimilarity('alpha beta gamma', 'delta epsilon zeta');
    expect(score).toBe(0);
  });

  test('returns value between 0 and 1 for partially overlapping content', () => {
    const a = 'shared line\nunique to A';
    const b = 'shared line\nunique to B';
    const score = jaccardSimilarity(a, b);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test('returns ≥ 0.7 for near-identical files', () => {
    // Simulate the boundary-values-guide.md ↔ boundary-guide.generated.md scenario:
    // two files sharing most lines but with slightly different headers
    const base = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const a = '> 自動生成ファイル — version A\n' + base;
    const b = '> 自動生成ファイル — version B\n' + base;
    expect(jaccardSimilarity(a, b)).toBeGreaterThanOrEqual(0.7);
  });
});

// ── detectDuplicates ──────────────────────────────────────────────────────────

describe('detectDuplicates', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns empty array when no files share auto-gen marker and high similarity', () => {
    const a = writeFile('docs/a.md', '# Unique content A\nfoo bar baz');
    const b = writeFile('docs/b.md', '# Unique content B\nqux quux corge');
    expect(detectDuplicates([a, b])).toEqual([]);
  });

  test('detects pair where one file has auto-gen marker and similarity is ≥ 0.7', () => {
    const sharedLines = Array.from({ length: 20 }, (_, i) => `identical line ${i}`).join('\n');
    const a = writeFile('docs/a.md', `> 自動生成ファイル\n${sharedLines}`);
    const b = writeFile('docs/b.md', `# Manual copy\n${sharedLines}\nextra line`);
    const result = detectDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0.7);
  });

  test('does not flag pair where both files lack auto-gen marker', () => {
    const sharedLines = Array.from({ length: 20 }, (_, i) => `common line ${i}`).join('\n');
    const a = writeFile('docs/a.md', `# Manual A\n${sharedLines}`);
    const b = writeFile('docs/b.md', `# Manual B\n${sharedLines}`);
    // No auto-gen marker in either file — should not be flagged
    expect(detectDuplicates([a, b])).toEqual([]);
  });

  test('does not flag pair with auto-gen marker but low similarity', () => {
    const a = writeFile('docs/a.md', '> 自動生成ファイル\n' + 'unique A\n'.repeat(20));
    const b = writeFile('docs/b.md', '# Completely different\n' + 'unique B\n'.repeat(20));
    expect(detectDuplicates([a, b])).toEqual([]);
  });

  test('returns score and both file paths in the result', () => {
    const shared = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const a = writeFile('docs/gen.md', `> 自動生成ファイル\n${shared}`);
    const b = writeFile('docs/copy.md', `# Copy\n${shared}`);
    const result = detectDuplicates([a, b]);
    expect(result[0]).toMatchObject({
      a: expect.any(String),
      b: expect.any(String),
      score: expect.any(Number),
    });
  });
});

// ── detectOrphans ─────────────────────────────────────────────────────────────

describe('detectOrphans', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns doc with broken-link rate > 50% as orphan candidate', () => {
    writeFile('services/exists.ts', 'export {};');
    const docPath = writeFile(
      'docs/spec.md',
      ['`services/exists.ts`', '`services/gone1.ts`', '`services/gone2.ts`'].join('\n'),
    );
    // 2/3 broken = 66% > 50% → orphan
    const result = detectOrphans([docPath], tmpRoot);
    expect(result).toContain(docPath);
  });

  test('does not flag doc with broken-link rate ≤ 50%', () => {
    writeFile('services/a.ts', 'export {};');
    writeFile('services/b.ts', 'export {};');
    const docPath = writeFile(
      'docs/spec.md',
      ['`services/a.ts`', '`services/b.ts`', '`services/gone.ts`'].join('\n'),
    );
    // 1/3 broken = 33% ≤ 50% → not orphan
    const result = detectOrphans([docPath], tmpRoot);
    expect(result).not.toContain(docPath);
  });

  test('skips docs with no backtick path references', () => {
    const docPath = writeFile('docs/no-refs.md', '# Design Notes\n\nSome prose without paths.');
    expect(detectOrphans([docPath], tmpRoot)).toEqual([]);
  });

  test('skips redirect stubs regardless of broken links', () => {
    const docPath = writeFile(
      'docs/deprecated.md',
      '<!-- @deprecated redirectTo: docs/new.md -->\n`services/gone.ts`\n`more/gone.ts`',
    );
    expect(detectOrphans([docPath], tmpRoot)).toEqual([]);
  });
});

// ── parsePhase ────────────────────────────────────────────────────────────────

describe('parsePhase', () => {
  test('returns 1 for --phase=1', () => {
    expect(parsePhase(['bun', 'script.ts', '--phase=1'])).toBe(1);
  });

  test('returns 2 for --phase=2', () => {
    expect(parsePhase(['bun', 'script.ts', '--phase=2'])).toBe(2);
  });

  test('returns "all" when --phase flag is absent', () => {
    expect(parsePhase([])).toBe('all');
    expect(parsePhase(['--check'])).toBe('all');
    expect(parsePhase(['--warn-only'])).toBe('all');
  });

  test('throws for unrecognised --phase value', () => {
    expect(() => parsePhase(['--phase=3'])).toThrow();
    expect(() => parsePhase(['--phase='])).toThrow();
    expect(() => parsePhase(['--phase=all'])).toThrow();
  });
});

// ── runPhase1 ─────────────────────────────────────────────────────────────────

describe('runPhase1', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns brokenLinks for non-existent referenced file', () => {
    writeFile('services/exists.ts', 'export {};');
    const docPath = writeFile('docs/spec.md', '`services/exists.ts`\n`services/gone.ts`');
    const { brokenLinks } = runPhase1([docPath], tmpRoot);
    expect(brokenLinks).toHaveLength(1);
    expect(brokenLinks[0].path).toBe('services/gone.ts');
  });

  test('does not include duplicates property in result', () => {
    const docPath = writeFile('docs/empty.md', '# No paths here');
    const result = runPhase1([docPath], tmpRoot);
    expect(result).not.toHaveProperty('duplicates');
    expect(result).toHaveProperty('brokenLinks');
    expect(result).toHaveProperty('orphans');
  });

  test('includes orphan when broken-link rate >50%', () => {
    const docPath = writeFile('docs/orphan.md', '`s/gone1.ts`\n`s/gone2.ts`\n`s/gone3.ts`');
    const { orphans } = runPhase1([docPath], tmpRoot);
    expect(orphans).toContain(docPath);
  });

  test('does not include orphan when broken-link rate ≤50%', () => {
    writeFile('services/a.ts', 'export {};');
    writeFile('services/b.ts', 'export {};');
    const docPath = writeFile(
      'docs/spec.md',
      '`services/a.ts`\n`services/b.ts`\n`services/gone.ts`',
    );
    const { orphans } = runPhase1([docPath], tmpRoot);
    expect(orphans).not.toContain(docPath);
  });

  test('skips redirect stubs', () => {
    const docPath = writeFile(
      'docs/stub.md',
      '<!-- @deprecated redirectTo: docs/new.md -->\n`services/gone.ts`',
    );
    const { brokenLinks, orphans } = runPhase1([docPath], tmpRoot);
    expect(brokenLinks).toHaveLength(0);
    expect(orphans).toHaveLength(0);
  });
});

// ── runPhase2 ─────────────────────────────────────────────────────────────────

describe('runPhase2', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns duplicates for near-identical files where one has auto-gen marker', () => {
    const shared = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const a = writeFile('docs/gen.md', `> 自動生成ファイル\n${shared}`);
    const b = writeFile('docs/copy.md', `# Copy\n${shared}`);
    const { duplicates } = runPhase2([a, b]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].score).toBeGreaterThanOrEqual(0.7);
  });

  test('does not include brokenLinks or orphans properties in result', () => {
    const docPath = writeFile('docs/empty.md', '# Nothing');
    const result = runPhase2([docPath]);
    expect(result).not.toHaveProperty('brokenLinks');
    expect(result).not.toHaveProperty('orphans');
    expect(result).toHaveProperty('duplicates');
  });

  test('returns empty duplicates when no auto-gen marker present', () => {
    const shared = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const a = writeFile('docs/a.md', `# Manual A\n${shared}`);
    const b = writeFile('docs/b.md', `# Manual B\n${shared}`);
    const { duplicates } = runPhase2([a, b]);
    expect(duplicates).toHaveLength(0);
  });
});

// ── Integration test (smoke — runs against real docs/) ────────────────────────

describe('check-docs-health (integration)', () => {
  test('exits 0 in warn-only mode (default)', () => {
    const { status, stdout } = runScript([]);
    expect(status).toBe(0);
    expect(stdout).toContain('Domain 1');
    expect(stdout).toContain('Domain 2');
    expect(stdout).toContain('Domain 3');
  });

  test('exits 0 with --warn-only flag', () => {
    const { status } = runScript(['--warn-only']);
    expect(status).toBe(0);
  });

  test('--check mode exits 0 or 1 depending on current violations', () => {
    const { status, stdout } = runScript(['--check']);
    // Both exit codes are valid — the important thing is correct output structure.
    expect([0, 1]).toContain(status);
    expect(stdout).toContain('Domain 1 (Broken links)');
    expect(stdout).toContain('Domain 2 (Duplicate/double-managed docs)');
    expect(stdout).toContain('Domain 3 (Orphaned docs');
  });

  test('detects known broken links in real docs/', () => {
    const { stdout } = runScript(['--warn-only']);
    // research.md confirmed: services/agents/question-detection.ts is deleted
    expect(stdout).toContain('services/agents/question-detection.ts');
  });

  test('Domain 2 output line is present in output', () => {
    const { stdout } = runScript(['--warn-only']);
    // Domain 2 header must always appear; violation count varies by codebase state.
    // NOTE: boundary-values-guide.md ↔ boundary-guide.generated.md share the
    //       auto-gen marker but their Jaccard similarity is ~0.29 (below 0.7 threshold)
    //       because the two guides cover different content despite similar metadata.
    expect(stdout).toContain('Domain 2 (Duplicate/double-managed docs)');
  });
});

// ── Phase integration tests ───────────────────────────────────────────────────

describe('check-docs-health --phase (integration)', () => {
  test('--phase=1 output contains Domain 1 and Domain 3 but not Domain 2', () => {
    const { status, stdout } = runScript(['--phase=1']);
    expect(status).toBe(0); // warn-only by default
    expect(stdout).toContain('Domain 1');
    expect(stdout).toContain('Domain 3');
    expect(stdout).not.toContain('Domain 2');
  });

  test('--phase=2 output contains Domain 2 but not Domain 1 or Domain 3', () => {
    const { status, stdout } = runScript(['--phase=2']);
    expect(status).toBe(0); // warn-only by default
    expect(stdout).toContain('Domain 2');
    expect(stdout).not.toContain('Domain 1');
    expect(stdout).not.toContain('Domain 3');
  });

  test('invalid --phase=3 exits with code 1', () => {
    const { status, stderr } = runScript(['--phase=3']);
    expect(status).toBe(1);
    expect(stderr).toContain('Unknown --phase value');
  });

  test('--phase=1 exits 0 in default warn-only mode even when broken links exist', () => {
    // Domain 1 violations exist in real docs/ (question-detection.ts is missing)
    // but default mode is warn-only, so exit code must be 0.
    const { status } = runScript(['--phase=1']);
    expect(status).toBe(0);
  });
});
