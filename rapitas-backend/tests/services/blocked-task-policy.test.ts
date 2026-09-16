/**
 * blocked-task-policy テスト
 *
 * task 727: DEFAULT_VERIFY_REPAIR_LIMIT の既定値固定と、
 * UserSettings.verifyRepairLimit / repairs 件数の境界値（2, 3, 4）での
 * resolveVerifyRepairLimit・classifyBlockedExclusion の判定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_VERIFY_REPAIR_LIMIT,
  resolveVerifyRepairLimit,
  classifyBlockedExclusion,
} from '../../services/workflow/blocked-task-policy';

describe('DEFAULT_VERIFY_REPAIR_LIMIT', () => {
  test('既定値は 2 であること（誤って変更されないための sanity check）', () => {
    expect(DEFAULT_VERIFY_REPAIR_LIMIT).toBe(2);
  });
});

describe('resolveVerifyRepairLimit', () => {
  test('UserSettings が無ければ既定値 (2) を返すこと', () => {
    expect(resolveVerifyRepairLimit(null)).toBe(DEFAULT_VERIFY_REPAIR_LIMIT);
  });

  test('verifyRepairLimit が未設定 (null) なら既定値を返すこと', () => {
    expect(resolveVerifyRepairLimit({ verifyRepairLimit: null })).toBe(DEFAULT_VERIFY_REPAIR_LIMIT);
  });

  test('verifyRepairLimit = 0 は正の数でないため既定値へフォールバックすること', () => {
    expect(resolveVerifyRepairLimit({ verifyRepairLimit: 0 })).toBe(DEFAULT_VERIFY_REPAIR_LIMIT);
  });

  test.each([2, 3, 4])('verifyRepairLimit = %i が設定されていればその値を返すこと', (limit) => {
    expect(resolveVerifyRepairLimit({ verifyRepairLimit: limit })).toBe(limit);
  });
});

describe('classifyBlockedExclusion — verifyRepairLimit 境界値 (2, 3, 4)', () => {
  const base = { workflowStatus: 'verify_done', ageMs: 0, attempts: 0 };

  test.each([2, 3, 4])(
    'verifyRepairLimit = %i のとき repairs が同数以上で verify_repair_exhausted になること',
    (limit) => {
      const exhausted = classifyBlockedExclusion({
        ...base,
        repairs: limit,
        verifyRepairLimit: limit,
      });
      expect(exhausted).toBe('verify_repair_exhausted');
    },
  );

  test.each([2, 3, 4])(
    'verifyRepairLimit = %i のとき repairs が1つ少なければ retryable になること',
    (limit) => {
      const retryable = classifyBlockedExclusion({
        ...base,
        repairs: limit - 1,
        verifyRepairLimit: limit,
      });
      expect(retryable).toBe('retryable');
    },
  );
});

describe('classifyBlockedExclusion — 検証不能の保留 (2026-09-13 task 912)', () => {
  const base = { workflowStatus: 'verify_done', ageMs: 0, attempts: 0, verifyRepairLimit: 2 };

  test('unverifiableHeld は予算が残っていても verification_unverifiable で除外される', () => {
    expect(classifyBlockedExclusion({ ...base, repairs: 0, unverifiableHeld: true })).toBe(
      'verification_unverifiable',
    );
  });

  test('awaiting_question は検証不能より優先される', () => {
    expect(
      classifyBlockedExclusion({
        ...base,
        workflowStatus: 'awaiting_question',
        repairs: 0,
        unverifiableHeld: true,
      }),
    ).toBe('awaiting_question');
  });

  test('unverifiableHeld が無ければ従来どおり retryable', () => {
    expect(classifyBlockedExclusion({ ...base, repairs: 0, unverifiableHeld: false })).toBe(
      'retryable',
    );
  });
});
