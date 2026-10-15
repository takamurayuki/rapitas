/**
 * log-concern-recurrence.test
 *
 * Fixtures are the real titles of the five log-derived tasks that completed
 * as 修正不要 on 2026-08-30 chasing the already-resolved Prisma mismatch.
 *
 * Run this file on its own (as the verification gate does): bun's mock.module
 * is process-global, and backlog-task-promoter.test.ts replaces
 * isLogConcernStillRecurring for its own purposes.
 */
import { describe, test, expect } from 'bun:test';
import {
  fragmentFromLogConcernTitle,
  fragmentRecursIn,
  isLogConcernStillRecurring,
} from './log-concern-recurrence';
import { normalizeMessage } from '../../system/log-health-check';

const RAW =
  'Invalid `prisma.agentExecution.findMany()` invocation in C:\\Projects\\rapitas\\x.ts:12:3';
const TITLE = `[ログ:ERROR] ${normalizeMessage(RAW).slice(0, 100)}`;

describe('fragmentFromLogConcernTitle', () => {
  test('レベルとプロジェクト接頭辞を剥がして断片を返す', () => {
    expect(
      fragmentFromLogConcernTitle('[ログ:ERROR] (mikke) gh command failed: gh pr create'),
    ).toBe('gh command failed: gh pr create');
    expect(fragmentFromLogConcernTitle('[ログ:WARN] health check timed out')).toBe(
      'health check timed out',
    );
  });

  test('ログ由来でないタイトルは null', () => {
    expect(fragmentFromLogConcernTitle('[自己検出] 反復ループ: cause=verify_repair')).toBeNull();
    expect(fragmentFromLogConcernTitle(null)).toBeNull();
  });
});

describe('fragmentRecursIn', () => {
  const fragment = fragmentFromLogConcernTitle(TITLE)!;

  test('同じシグネチャに正規化される行があれば再発', () => {
    const entries = [{ level: 50, msg: RAW.replace('x.ts:12:3', 'y.ts:99:1'), time: 1 }];
    expect(fragmentRecursIn(fragment, entries)).toBe(true);
  });

  test('別の事象しか無ければ再発ではない', () => {
    const entries = [{ level: 50, msg: 'gh command failed: gh pr create --title x', time: 1 }];
    expect(fragmentRecursIn(fragment, entries)).toBe(false);
  });

  test('WARN 未満の行は見ない', () => {
    const entries = [{ level: 30, msg: RAW, time: 1 }];
    expect(fragmentRecursIn(fragment, entries)).toBe(false);
  });
});

describe('isLogConcernStillRecurring', () => {
  test('ログに無ければ false（沈黙）', async () => {
    const r = await isLogConcernStillRecurring(
      { title: TITLE },
      { nowMs: 1_000_000, readEntries: async () => [] },
    );
    expect(r).toBe(false);
  });

  test('ログにあれば true', async () => {
    const r = await isLogConcernStillRecurring(
      { title: TITLE },
      { nowMs: 1_000_000, readEntries: async () => [{ level: 50, msg: RAW, time: 999_000 }] },
    );
    expect(r).toBe(true);
  });

  test('読み取り失敗やログ由来でないタイトルは null（fail open）', async () => {
    expect(
      await isLogConcernStillRecurring(
        { title: TITLE },
        {
          nowMs: 1,
          readEntries: async () => {
            throw new Error('boom');
          },
        },
      ),
    ).toBeNull();
    expect(await isLogConcernStillRecurring({ title: '[Idea] 何か' })).toBeNull();
  });
});
