/**
 * fallback-handler ユニットテスト
 *
 * isSessionResumeFailure の判定ロジックを検証する。
 * regression: resume モードでの任意失敗が常に true を返していた誤検知を防ぐ。
 */
import { describe, expect, test } from 'bun:test';
import { isSessionResumeFailure } from './fallback-handler';
import type { AgentExecutionResult } from '../base-agent';

/** テスト用の最小 AgentExecutionResult を構築する */
function makeResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    success: false,
    output: '',
    artifacts: [],
    commits: [],
    executionTimeMs: 30000,
    waitingForInput: false,
    ...overrides,
  };
}

const SESSION_ID = 'abc123-dead-beef-0000-000000000001';

describe('isSessionResumeFailure', () => {
  describe('正常な失敗（session 失効ではないケース）', () => {
    test('working dir not found エラー（30秒） → false', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nWorking directory does not exist: /some/path',
        executionTimeMs: 30000,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });

    test('短時間 exit 1 でも session 文言なし → false（時間単独トリガー廃止の確認）', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\n【Session Resume Mode】Session ID: abc123',
        executionTimeMs: 800,
      });
      // NOTE: 旧実装は executionTimeMs < 10000 単独で true を返していた。それが誤検知の原因。
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });

    test('exit code 1 のみ（code 1 単独マッチを廃止した回帰確認） → false', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1',
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });

    test('spawn 直後の即時失敗（errorBuffer 空・exit 1） → false', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1',
        executionTimeMs: 50,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });
  });

  describe('実際のセッション失効メッセージ → true', () => {
    test('"no conversation found" → true', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nno conversation found',
        executionTimeMs: 1200,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"session not found" → true', () => {
      const result = makeResult({
        errorMessage: `Process exited with code 1\n\nsession not found: ${SESSION_ID}`,
        executionTimeMs: 900,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"session id expired" → true', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nsession id expired',
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"session id invalid" → true', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nsession id invalid',
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"session id does not exist" → true', () => {
      const result = makeResult({
        errorMessage: 'session id does not exist',
        executionTimeMs: 1000,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"no such session" → true', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nno such session',
        executionTimeMs: 800,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"could not resume session" → true', () => {
      const result = makeResult({
        errorMessage: 'could not resume session abc123',
        executionTimeMs: 600,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"resume failed" → true', () => {
      const result = makeResult({
        errorMessage: 'Process exited with code 1\n\nresume failed',
        executionTimeMs: 1500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('"conversation not found" → true（conversation パターン）', () => {
      const result = makeResult({
        errorMessage: 'conversation abc123 not found',
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });

    test('長時間実行後でも session 失効文言あり → true（時間に依存しないことを確認）', () => {
      const result = makeResult({
        errorMessage: 'no conversation found',
        executionTimeMs: 90000,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(true);
    });
  });

  describe('前提条件チェック', () => {
    test('claudeSessionId が null → false', () => {
      const result = makeResult({
        errorMessage: 'no conversation found',
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, null)).toBe(false);
    });

    test('waitingForInput=true → false（質問待ちは失敗ではない）', () => {
      const result = makeResult({
        success: true,
        waitingForInput: true,
        errorMessage: 'no conversation found',
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });

    test('success=true → false（成功結果は失効扱いしない）', () => {
      const result = makeResult({
        success: true,
        waitingForInput: false,
        errorMessage: 'no conversation found',
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });

    test('errorMessage が undefined（空文字扱い） → false', () => {
      const result = makeResult({
        errorMessage: undefined,
        executionTimeMs: 500,
      });
      expect(isSessionResumeFailure(result, SESSION_ID)).toBe(false);
    });
  });
});
