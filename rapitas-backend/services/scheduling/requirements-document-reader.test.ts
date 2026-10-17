/**
 * requirements-document-reader.test
 *
 * Reading the working tree is the trap this module exists to avoid. A project's
 * main checkout only advances when something pulls, and nothing in the intake
 * job does: measured 2026-10-11, rapitas's own checkout sat SEVEN commits
 * behind origin and temporaid's three, and reading the stale copy led to a
 * wrong conclusion twice in one session.
 *
 * Uses a real local repository so the git path is exercised rather than mocked,
 * with a second clone standing in for `origin`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRequirementsFile, MAX_REQUIREMENTS_BYTES } from './requirements-document-reader';

let root: string;
let repo: string;

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

/** Write docs/requirements.md in a repo and commit it. */
function commitDoc(dir: string, content: string, message: string): void {
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'requirements.md'), content, 'utf8');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', message]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reqdoc-'));
  // `origin` is a bare repo the working repo pushes to, so origin/<branch> is
  // a real ref rather than a fixture.
  const origin = join(root, 'origin.git');
  mkdirSync(origin, { recursive: true });
  git(origin, ['init', '--bare', '--initial-branch=develop']);

  repo = join(root, 'work');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--initial-branch=develop']);
  git(repo, ['config', 'user.email', 't@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['remote', 'add', 'origin', origin]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readRequirementsFile', () => {
  // Moved here from requirement-intake-job.test.ts, which had grown past the
  // line limit and was testing this module rather than its own.
  test('returns null for a missing file and the content for an existing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-doc-plain-'));
    const doc = '# 機能要件\n\n- [F-01] ログイン\n';
    try {
      expect(await readRequirementsFile(dir)).toBeNull();
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs', 'requirements.md'), doc, 'utf8');
      expect(await readRequirementsFile(dir)).toBe(doc);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prefers origin over a working tree that is behind it', () => {
    commitDoc(repo, '# 機能要件\n\n- [F-01] 新しい内容\n', 'new');
    git(repo, ['push', '-u', 'origin', 'develop']);
    // Now make the working tree DIFFERENT from what origin holds.
    writeFileSync(join(repo, 'docs', 'requirements.md'), '# 古い内容\n', 'utf8');

    return readRequirementsFile(repo, 'develop').then((content) => {
      expect(content).toContain('新しい内容');
      expect(content).not.toContain('古い内容');
    });
  });

  test('falls back to the working tree when the branch is unknown', async () => {
    commitDoc(repo, '# ツリーの内容\n', 'only');
    // No branch given: nothing identifies an authoritative ref.
    expect(await readRequirementsFile(repo)).toContain('ツリーの内容');
  });

  test('falls back to the working tree when the branch does not exist on origin', async () => {
    commitDoc(repo, '# ツリーの内容\n', 'only');
    expect(await readRequirementsFile(repo, 'no-such-branch')).toContain('ツリーの内容');
  });

  test('returns null when the document exists nowhere', async () => {
    expect(await readRequirementsFile(repo, 'develop')).toBeNull();
    expect(await readRequirementsFile(join(root, 'absent'))).toBeNull();
  });

  test('rejects an oversized document from the working tree', async () => {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(
      join(repo, 'docs', 'requirements.md'),
      'x'.repeat(MAX_REQUIREMENTS_BYTES + 1),
      'utf8',
    );
    expect(await readRequirementsFile(repo)).toBeNull();
  });

  test('rejects an oversized document from origin', async () => {
    commitDoc(repo, 'y'.repeat(MAX_REQUIREMENTS_BYTES + 1), 'big');
    git(repo, ['push', '-u', 'origin', 'develop']);
    // Keep the tree small, so a non-null result could only come from origin.
    writeFileSync(join(repo, 'docs', 'requirements.md'), 'small', 'utf8');
    expect(await readRequirementsFile(repo, 'develop')).toBe('small');
  });

  test('a blank branch name is treated as unknown, not as a ref', async () => {
    commitDoc(repo, '# ツリーの内容\n', 'only');
    expect(await readRequirementsFile(repo, '   ')).toContain('ツリーの内容');
  });
});
