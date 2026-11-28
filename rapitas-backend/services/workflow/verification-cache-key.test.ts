/**
 * verification-cache-key.test
 *
 * Real-git regressions for computeVerificationCacheKey (task 897 supervisor
 * findings). Moved unchanged from verification-job-runner.test.ts when the
 * function moved to verification-cache-key.ts (task 1582 file split).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const runGitCommandMock = mock(async (_args: string[], _cwd?: string): Promise<string> => '');
mock.module('../github/git-exec', () => ({ runGitCommand: runGitCommandMock }));
mock.module('../../config', () => ({
  prisma: { task: { findUnique: mock(async () => null) } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));
mock.module('../agents/verification/automated-verifier', () => ({
  runAutomatedVerification: mock(async () => ({ ok: true, summary: 'ok', checks: [] })),
  renderVerificationMarkdown: mock(() => ''),
  looksLikeBugFixTask: () => false,
  requiresTestsForTask: () => false,
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: mock(async () => null) }));
mock.module('../task/task-resolver', () => ({
  resolvePreferredBaseBranch: mock(async () => 'develop'),
}));

const { computeVerificationCacheKey } = await import('./verification-cache-key');

describe('computeVerificationCacheKey (実git回帰: task897 監督差戻し)', () => {
  let repoDir: string;
  const realRunGitCommand = async (args: string[], cwd?: string): Promise<string> =>
    execFileSync('git', args, { cwd: cwd ?? repoDir, encoding: 'utf8' }).trim();

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'selfverify-cachekey-'));
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'app.txt'), 'initial\n');
    execFileSync('git', ['add', 'app.txt'], { cwd: repoDir });
    execFileSync('git', ['commit', '-q', '-m', 'root'], { cwd: repoDir });
    runGitCommandMock.mockImplementation(realRunGitCommand);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test('同一 dirty tracked ファイルの再編集で key が変わる（監督実測: git status --porcelain だけでは不変だった）', async () => {
    writeFileSync(join(repoDir, 'app.txt'), 'edit A\n');
    const keyA = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    writeFileSync(join(repoDir, 'app.txt'), 'edit B\n');
    const keyB = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);
  });

  test('未追跡ファイルの内容変更で key が変わり、同一内容の再計算では不変', async () => {
    writeFileSync(join(repoDir, 'new.txt'), 'v1\n');
    const key1 = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    const key1Again = await computeVerificationCacheKey({
      worktreePath: repoDir,
      requireTests: false,
    });
    expect(key1).not.toBeNull();
    expect(key1).toBe(key1Again);

    writeFileSync(join(repoDir, 'new.txt'), 'v2\n');
    const key2 = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    expect(key2).not.toBe(key1);
  });

  test('クリーンな worktree なら2回の呼び出しで同一 key（非null）を返す', async () => {
    const keyA = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    const keyB = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
  });

  test('未追跡合計サイズが安全弁の上限を超えると null を返す（キャッシュ回避）', async () => {
    writeFileSync(join(repoDir, 'big.bin'), Buffer.alloc(1024, 1));
    const prevLimit = process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_BYTES;
    process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_BYTES = '100';
    try {
      const key = await computeVerificationCacheKey({
        worktreePath: repoDir,
        requireTests: false,
      });
      expect(key).toBeNull();
    } finally {
      if (prevLimit === undefined) delete process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_BYTES;
      else process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_BYTES = prevLimit;
    }
  });

  test('検証入力（planContent等）が変われば同一worktreeでも key が変わる', async () => {
    const keyA = await computeVerificationCacheKey({
      worktreePath: repoDir,
      requireTests: false,
      planContent: 'plan A',
    });
    const keyB = await computeVerificationCacheKey({
      worktreePath: repoDir,
      requireTests: false,
      planContent: 'plan B',
    });
    expect(keyA).not.toBe(keyB);
  });

  test('回帰(task897 監督差戻し): 未追跡ファイルのフレーミング衝突 — 単一ファイル(NUL区切りを内容に含む)と複数ファイルで key が一致しない', async () => {
    // A single untracked file 'a' containing the raw bytes x\0b\0y reduces,
    // under the old `relPath + NUL + content + NUL` concatenation scheme, to
    // the exact same byte stream as two untracked files a='x' and b='y'
    // (both are `a\0x\0b\0y\0`) — reconfirmed against this file's own prior
    // implementation before this fix (both hashed to `c8d9a2ee...`).
    writeFileSync(join(repoDir, 'a'), Buffer.from([0x78, 0x00, 0x62, 0x00, 0x79]));
    const keySingleFileWithEmbeddedNuls = await computeVerificationCacheKey({
      worktreePath: repoDir,
      requireTests: false,
    });

    unlinkSync(join(repoDir, 'a'));
    writeFileSync(join(repoDir, 'a'), 'x');
    writeFileSync(join(repoDir, 'b'), 'y');
    const keyTwoFiles = await computeVerificationCacheKey({
      worktreePath: repoDir,
      requireTests: false,
    });

    expect(keySingleFileWithEmbeddedNuls).not.toBeNull();
    expect(keyTwoFiles).not.toBeNull();
    expect(keySingleFileWithEmbeddedNuls).not.toBe(keyTwoFiles);
  });

  test('回帰(task897 監督差戻し): 未追跡パスにシンボリックリンクが含まれる場合は null を返す（キャッシュ回避）', async () => {
    writeFileSync(join(repoDir, 'target.txt'), 'target content\n');
    // target.txt itself stays untracked too — only the link's presence
    // should matter, not whether the target is tracked.
    symlinkSync(join(repoDir, 'target.txt'), join(repoDir, 'link.txt'), 'file');
    const key = await computeVerificationCacheKey({ worktreePath: repoDir, requireTests: false });
    expect(key).toBeNull();
  });
});
