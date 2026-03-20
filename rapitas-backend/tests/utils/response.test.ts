/**
 * Response Utilities テスト
 * API レスポンス作成ユーティリティのテスト
 */
import { describe, test, expect } from 'bun:test';
import { createResponse, createErrorResponse } from '../../utils/common/response';

describe('createResponse', () => {
  test('データ付きの成功レスポンスを作成すること', () => {
    const result = createResponse({ id: 1, name: 'test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.error).toBeUndefined();
  });

  test('メッセージ付きの成功レスポンスを作成すること', () => {
    const result = createResponse('data', 'Created successfully');
    expect(result.success).toBe(true);
    expect(result.data).toBe('data');
    expect(result.message).toBe('Created successfully');
  });

  test('メッセージなしの場合undefinedであること', () => {
    const result = createResponse([1, 2, 3]);
    expect(result.message).toBeUndefined();
  });

  test('null/undefinedデータも受け入れること', () => {
    const result = createResponse(null);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe('createErrorResponse', () => {
  test('エラーメッセージ付きのエラーレスポンスを作成すること', () => {
    const result = createErrorResponse('Not found');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not found');
    expect(result.data).toBeUndefined();
  });

  test('ステータスコード付きでもレスポンス構造は同じであること', () => {
    const result = createErrorResponse('Bad request', 400);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Bad request');
  });
});
