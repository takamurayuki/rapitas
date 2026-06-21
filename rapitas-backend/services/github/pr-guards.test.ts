/**
 * pr-guards.test
 *
 * Unit tests for the checkPrActionable() guard helper.
 */
import { describe, test, expect } from 'bun:test';
import { checkPrActionable } from './pr-guards';

describe('checkPrActionable', () => {
  describe('prNumber validity (422)', () => {
    test('正常な prNumber は null を返す', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'open' },
        { operationLabel: 'テスト操作', requireOpen: false },
      );
      expect(result).toBeNull();
    });

    test('prNumber が 0 のとき 422 を返す', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'open' },
        { operationLabel: 'テスト操作', requireOpen: false },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
      expect(result!.body.success).toBe(false);
      expect(result!.body.error).toContain('テスト操作');
    });

    test('prNumber が負のとき 422 を返す', () => {
      const result = checkPrActionable(
        { prNumber: -1, state: 'open' },
        { operationLabel: 'base変更', requireOpen: false },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
    });

    test('prNumber が小数のとき 422 を返す', () => {
      const result = checkPrActionable(
        { prNumber: 1.5, state: 'open' },
        { operationLabel: 'マージ', requireOpen: false },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
    });

    test('エラーメッセージに prNumber 値が含まれる', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'open' },
        { operationLabel: 'base変更', requireOpen: false },
      );
      expect(result!.body.error).toContain('prNumber=0');
    });
  });

  describe('state pre-check (409)', () => {
    test('requireOpen=true かつ state=open のとき null を返す', () => {
      const result = checkPrActionable(
        { prNumber: 42, state: 'open' },
        { operationLabel: '承認', requireOpen: true },
      );
      expect(result).toBeNull();
    });

    test('requireOpen=true かつ state=merged のとき 409 を返す', () => {
      const result = checkPrActionable(
        { prNumber: 42, state: 'merged' },
        { operationLabel: '承認', requireOpen: true },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(409);
      expect(result!.body.success).toBe(false);
      expect(result!.body.error).toContain('承認');
      expect(result!.body.error).toContain('state=merged');
    });

    test('requireOpen=true かつ state=closed のとき 409 を返す', () => {
      const result = checkPrActionable(
        { prNumber: 42, state: 'closed' },
        { operationLabel: 'マージ', requireOpen: true },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(409);
    });

    test('requireOpen=false かつ state=merged のとき null を返す（コメントは許可）', () => {
      const result = checkPrActionable(
        { prNumber: 42, state: 'merged' },
        { operationLabel: 'コメント投稿', requireOpen: false },
      );
      expect(result).toBeNull();
    });

    test('requireOpen=false かつ state=closed のとき null を返す', () => {
      const result = checkPrActionable(
        { prNumber: 42, state: 'closed' },
        { operationLabel: 'コメント投稿', requireOpen: false },
      );
      expect(result).toBeNull();
    });
  });

  describe('guard priority — prNumber check runs before state check', () => {
    test('prNumber が不正かつ state が non-open のとき 422 を返す（prNumber を優先）', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'merged' },
        { operationLabel: 'マージ', requireOpen: true },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
    });
  });
});
