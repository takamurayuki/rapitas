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

    test.each([
      {
        name: '0 のとき 422 を返す',
        prNumber: 0,
        label: 'テスト操作',
        errorContains: 'テスト操作',
      },
      { name: '負のとき 422 を返す', prNumber: -1, label: 'base変更', errorContains: undefined },
      { name: '小数のとき 422 を返す', prNumber: 1.5, label: 'マージ', errorContains: undefined },
    ])('prNumber が $name', ({ prNumber, label, errorContains }) => {
      const result = checkPrActionable(
        { prNumber, state: 'open' },
        { operationLabel: label, requireOpen: false },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
      // Only the first original case asserted body detail; preserve that distinction.
      if (errorContains !== undefined) {
        expect(result!.body.success).toBe(false);
        expect(result!.body.error).toContain(errorContains);
      }
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
    test.each([
      {
        name: 'true かつ state=open のとき null を返す',
        state: 'open' as const,
        requireOpen: true,
        label: '承認',
        expected: { kind: 'null' as const },
      },
      {
        name: 'true かつ state=merged のとき 409 を返す',
        state: 'merged' as const,
        requireOpen: true,
        label: '承認',
        expected: { kind: 'error' as const, contains: ['承認', 'state=merged'] },
      },
      {
        name: 'true かつ state=closed のとき 409 を返す',
        state: 'closed' as const,
        requireOpen: true,
        label: 'マージ',
        expected: { kind: 'error' as const, contains: [] as string[] },
      },
      {
        name: 'false かつ state=merged のとき null を返す（コメントは許可）',
        state: 'merged' as const,
        requireOpen: false,
        label: 'コメント投稿',
        expected: { kind: 'null' as const },
      },
      {
        name: 'false かつ state=closed のとき null を返す',
        state: 'closed' as const,
        requireOpen: false,
        label: 'コメント投稿',
        expected: { kind: 'null' as const },
      },
    ])('requireOpen=$name', ({ state, requireOpen, label, expected }) => {
      const result = checkPrActionable(
        { prNumber: 42, state },
        { operationLabel: label, requireOpen },
      );
      if (expected.kind === 'null') {
        expect(result).toBeNull();
        return;
      }
      expect(result).not.toBeNull();
      expect(result!.status).toBe(409);
      if (expected.contains.length > 0) {
        expect(result!.body.success).toBe(false);
      }
      for (const substr of expected.contains) {
        expect(result!.body.error).toContain(substr);
      }
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
