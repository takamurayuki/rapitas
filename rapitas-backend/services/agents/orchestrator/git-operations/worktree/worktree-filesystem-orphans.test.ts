/**
 * worktree-filesystem-orphans.test
 *
 * 実測した log ノイズ（2026-10-13〜14）。
 *
 * 非再帰 rmdir が非空ディレクトリを拒否するのは**設計された安全確認**であり、
 * 失敗ではない（`node_modules` はメインチェックアウトへのジャンクションなので、
 * 再帰削除は共有依存ツリーを貫通して消す）。それにも関わらず、拒否1件ごとに
 * スタックトレース付きの WARN を掃除サイクルごとに出し続けていた。
 *
 * 実測: 8件の孤児（task-1107 / 1161 / 1164 / 1166 / 1172 / 1206 / 1207 / 1230）が
 * 毎サイクル WARN を8本出していた。いずれも所有タスクは done/completed で、
 * 中身は 1〜2MB のソース（合計約9MB、node_modules はジャンクション）。実害は
 * ディスクではなく、**本物の警告がこのノイズに埋もれること**。
 *
 * 想定内の拒否は集約した info に落とし、本当にアクセス不能な場合（EPERM/EBUSY
 * 等）だけ WARN に残す。
 */
import { describe, expect, test } from 'bun:test';
import { classifyPreservation, parseWorktreeTaskId } from './worktree-filesystem-orphans';

/** Builds an fs error the way node does. */
const fsError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: whatever, rmdir 'x'`), { code });

describe('classifyPreservation', () => {
  // rmdir refusing a nonempty directory IS the check succeeding.
  test.each(['ENOTEMPTY', 'EEXIST'])('%s は想定内の拒否', (code) => {
    expect(classifyPreservation(fsError(code))).toBe('nonempty');
  });

  // These mean the sweep could not even evaluate the directory — worth a WARN.
  test.each(['EPERM', 'EBUSY', 'EACCES', 'EIO'])('%s は本当のアクセス不能', (code) => {
    expect(classifyPreservation(fsError(code))).toBe('inaccessible');
  });

  test('コードの無いエラーは安全側（アクセス不能）に倒す', () => {
    expect(classifyPreservation(new Error('no code'))).toBe('inaccessible');
    expect(classifyPreservation('a string')).toBe('inaccessible');
    expect(classifyPreservation(undefined)).toBe('inaccessible');
  });
});

describe('parseWorktreeTaskId', () => {
  // The directory name is the only place the owning task survives once git's
  // metadata is gone, so the summary can still name what to reclaim.
  test.each([
    ['task-1107-13c4ff03', 1107],
    ['task-1230-a6d79c6c', 1230],
    ['task-9-abc', 9],
  ])('%s -> %p', (name, expected) => {
    expect(parseWorktreeTaskId(name)).toBe(expected);
  });

  test.each(['wt-e0e558a5', 'redcheck-ca4bd82e069b', 'triage-dfc85ae7', 'task-', 'task-x-1', ''])(
    'タスク由来でない名前は null: %p',
    (name) => {
      expect(parseWorktreeTaskId(name)).toBeNull();
    },
  );
});
