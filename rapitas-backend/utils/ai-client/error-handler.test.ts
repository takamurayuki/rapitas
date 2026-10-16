/**
 * ai-client/error-handler ユニットテスト
 *
 * formatApiError の各エラー分類（認証・混雑・レート制限・無料枠超過・
 * モデル未検出・未分類）と handleApiError の再throw挙動を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { formatApiError, handleApiError } from './error-handler';

describe('formatApiError', () => {
  test('classifies an authentication error (401)', () => {
    const msg = formatApiError(new Error('Request failed: 401 invalid x-api-key'), 'claude');
    expect(msg).toContain('Claude');
    expect(msg).toContain('APIキーが無効');
  });

  test('classifies an authentication_error message', () => {
    const msg = formatApiError(new Error('authentication_error: bad key'), 'chatgpt');
    expect(msg).toContain('OpenAI');
    expect(msg).toContain('APIキーが無効');
  });

  test('classifies an overloaded (529) error', () => {
    const msg = formatApiError(new Error('529 Overloaded'), 'claude');
    expect(msg).toContain('混雑');
  });

  test('classifies a rate-limit (429) error', () => {
    const msg = formatApiError(new Error('429 Too Many Requests'), 'gemini');
    expect(msg).toContain('レート制限');
  });

  test('classifies a free-tier quota error distinctly from a generic rate limit', () => {
    const msg = formatApiError(new Error('RESOURCE_EXHAUSTED: free_tier quota exceeded'), 'gemini');
    expect(msg).toContain('無料枠');
    expect(msg).toContain('Billing');
  });

  test('classifies a model-not-found (404) error', () => {
    const msg = formatApiError(new Error('404 model is not found'), 'ollama');
    expect(msg).toContain('モデルが見つかりません');
  });

  test('returns the original message for an unclassified Error', () => {
    const msg = formatApiError(new Error('some other failure'), 'claude');
    expect(msg).toBe('some other failure');
  });

  test('returns a generic message for a non-Error thrown value', () => {
    const msg = formatApiError('a raw string throw', 'claude');
    expect(msg).toBe('AIとの通信中にエラーが発生しました');
  });

  test('checks quota before model-not-found when a message could match both', () => {
    // "rate limit" (quota) message that also happens to mention "not found" text.
    const msg = formatApiError(
      new Error('rate limit exceeded, resource not found later'),
      'claude',
    );
    expect(msg).toContain('レート制限');
  });
});

describe('handleApiError', () => {
  test('throws a new Error with the translated message when classified', () => {
    expect(() => handleApiError(new Error('401 invalid api key'), 'claude')).toThrow(
      /APIキーが無効/,
    );
  });

  test('re-throws the original error object when the message is unclassified', () => {
    const original = new Error('totally unrecognized failure');
    try {
      handleApiError(original, 'claude');
      throw new Error('handleApiError should not return');
    } catch (caught) {
      expect(caught).toBe(original);
    }
  });
});
