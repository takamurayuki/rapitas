/**
 * PR Guards ユニットテスト
 * checkPrActionable() の境界値テスト（pure function、モック不要）
 */
import { describe, test, expect } from 'bun:test';
import { checkPrActionable } from '../../../services/github/pr-guards';

describe('checkPrActionable()', () => {
  describe('prNumber 整合性チェック (422)', () => {
    test('正常な prNumber は null を返すこと', () => {
      expect(
        checkPrActionable({ prNumber: 42, state: 'open' }, { operationLabel: 'テスト', requireOpen: true }),
      ).toBeNull();
    });

    test('prNumber=0 は 422 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'open' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(422);
      expect(result?.body.success).toBe(false);
    });

    test('prNumber=-1 は 422 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: -1, state: 'open' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(422);
    });

    test('prNumber=1.5（非整数）は 422 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 1.5, state: 'open' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(422);
    });

    test('prNumber=NaN は 422 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: NaN, state: 'open' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(422);
    });
  });

  describe('state 事前チェック（requireOpen: true）', () => {
    test('state=open は null を返すこと', () => {
      expect(
        checkPrActionable({ prNumber: 1, state: 'open' }, { operationLabel: 'テスト', requireOpen: true }),
      ).toBeNull();
    });

    test('state=merged は 409 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'merged' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(409);
      expect(result?.body.success).toBe(false);
    });

    test('state=closed は 409 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'closed' },
        { operationLabel: 'テスト', requireOpen: true },
      );
      expect(result?.status).toBe(409);
    });
  });

  describe('state チェック無効（requireOpen: false）', () => {
    test('state=merged でも null を返すこと（コメント許可）', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'merged' },
        { operationLabel: 'コメント追加', requireOpen: false },
      );
      expect(result).toBeNull();
    });

    test('state=closed でも null を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'closed' },
        { operationLabel: 'コメント追加', requireOpen: false },
      );
      expect(result).toBeNull();
    });

    test('prNumber 不正は requireOpen:false でも 422 を返すこと', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'merged' },
        { operationLabel: 'コメント追加', requireOpen: false },
      );
      expect(result?.status).toBe(422);
    });
  });

  describe('エラーメッセージ検証', () => {
    test('422 メッセージに operationLabel が含まれること', () => {
      const result = checkPrActionable(
        { prNumber: 0, state: 'open' },
        { operationLabel: 'base変更', requireOpen: true },
      );
      expect(result?.body.error).toContain('base変更');
    });

    test('409 メッセージに operationLabel と state が含まれること', () => {
      const result = checkPrActionable(
        { prNumber: 1, state: 'merged' },
        { operationLabel: 'approve', requireOpen: true },
      );
      expect(result?.body.error).toContain('approve');
      expect(result?.body.error).toContain('merged');
    });
  });
});
