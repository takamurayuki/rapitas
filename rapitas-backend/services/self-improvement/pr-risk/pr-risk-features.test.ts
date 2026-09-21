/**
 * pr-risk-features test
 *
 * Pins feature extraction from `gh pr view --json` output: log-scaled size,
 * human/agent author, dependency-manifest and Prisma schema detection.
 */
import { describe, it, expect } from 'bun:test';
import { extractFeatures, parseRepoFromUrl, fetchPrSnapshot } from './pr-risk-features';

const gh = (files: string[], additions = 0, deletions = 0) => ({
  additions,
  deletions,
  changedFiles: files.length,
  files: files.map((path) => ({ path })),
});

describe('extractFeatures', () => {
  it('log-scales diff size and file count', () => {
    const f = extractFeatures(gh(['a.ts', 'b.ts'], 90, 10), { hasLinkedTask: true });
    expect(f.file_size).toBeCloseTo(Math.log(101), 12);
    expect(f.files_changed).toBeCloseTo(Math.log(3), 12);
  });

  it('is all-zero for an empty diff by an agent', () => {
    expect(extractFeatures(gh([]), { hasLinkedTask: true })).toEqual({
      file_size: 0,
      files_changed: 0,
      author: 0,
      dependency_change: 0,
      schema_change: 0,
    });
  });

  it('marks human-authored PRs (no linked task) as author = 1', () => {
    expect(extractFeatures(gh([]), { hasLinkedTask: false }).author).toBe(1);
  });

  it('detects lockfile-only / manifest changes in any package', () => {
    for (const p of [
      'bun.lock',
      'rapitas-frontend/pnpm-lock.yaml',
      'x/package.json',
      'src-tauri/Cargo.toml',
      'Cargo.lock',
      'package-lock.json',
      'bun.lockb',
    ]) {
      expect(extractFeatures(gh([p]), { hasLinkedTask: true }).dependency_change).toBe(1);
    }
    expect(
      extractFeatures(gh(['src/package-json.ts']), { hasLinkedTask: true }).dependency_change,
    ).toBe(0);
  });

  it('detects Prisma schema changes', () => {
    const f = extractFeatures(gh(['rapitas-backend/prisma/schema/x.prisma']), {
      hasLinkedTask: true,
    });
    expect(f.schema_change).toBe(1);
    expect(extractFeatures(gh(['docs/prisma.md']), { hasLinkedTask: true }).schema_change).toBe(0);
  });
});

describe('parseRepoFromUrl', () => {
  it('extracts owner/repo from a PR URL', () => {
    expect(parseRepoFromUrl('https://github.com/o/r/pull/1')).toBe('o/r');
    expect(parseRepoFromUrl('not a url')).toBeNull();
  });
});

describe('fetchPrSnapshot', () => {
  it('reads the PR once via gh and maps it', async () => {
    const calls: string[][] = [];
    const snap = await fetchPrSnapshot('/repo', 7, { hasLinkedTask: true }, async (args) => {
      calls.push(args);
      return JSON.stringify({
        ...gh(['bun.lock'], 3, 1),
        headRefOid: 'deadbeef',
        url: 'https://github.com/o/r/pull/7',
      });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('additions,deletions,changedFiles,files,headRefOid,url');
    expect(snap).toMatchObject({ repo: 'o/r', headSha: 'deadbeef' });
    expect(snap.features.dependency_change).toBe(1);
  });

  it('throws on an unparsable response (callers fail open)', async () => {
    await expect(
      fetchPrSnapshot('/repo', 7, { hasLinkedTask: true }, async () => 'nope'),
    ).rejects.toThrow();
  });
});
