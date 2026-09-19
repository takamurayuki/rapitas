/**
 * requirement-plan-mismatch-reviewer テスト
 *
 * task 909 attempt 2: `.supervisor/` のようなパス名に依存しない、原文根拠付き
 * の要件-計画不整合レビュー。AIの自己申告した sourceQuote が実際に description
 * 原文に存在しない限り mismatch を成立させないことが中心。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockLoggerWarn = mock(() => {});
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: mockLoggerWarn, error: () => {}, debug: () => {} }),
}));

const mockSendAIMessage = mock(() => Promise.resolve({ content: '{}' }));
const mockGetDefaultProvider = mock(() => Promise.resolve('claude'));
const mockIsAnyApiKeyConfigured = mock(() => Promise.resolve(true));

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: mockIsAnyApiKeyConfigured,
}));

const { reviewRequirementPlanMismatch } = await import('./requirement-plan-mismatch-reviewer');

beforeEach(() => {
  mockLoggerWarn.mockReset();
  mockSendAIMessage.mockReset().mockResolvedValue({ content: '{}' });
  mockGetDefaultProvider.mockReset().mockResolvedValue('claude');
  mockIsAnyApiKeyConfigured.mockReset().mockResolvedValue(true);
});

describe('reviewRequirementPlanMismatch', () => {
  test('APIキー未設定なら AI を呼ばず unknown を返す', async () => {
    mockIsAnyApiKeyConfigured.mockResolvedValueOnce(false);

    const result = await reviewRequirementPlanMismatch({
      description: '任意の説明',
      criterion: '任意の基準',
      currentPlan: '任意の計画',
    });

    expect(result).toEqual({ verdict: 'unknown', sourceQuote: null, reason: 'ai_unavailable' });
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('description原文に一致する引用がある mismatch はそのまま成立する', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'mismatch',
        sourceQuote: '.supervisor/ 配下にログ収集ツールを新規実装してほしい',
        reason: '説明に明示的な新規実装要求がある',
      }),
    });

    const result = await reviewRequirementPlanMismatch({
      description:
        'このタスクでは .supervisor/ 配下にログ収集ツールを新規実装してほしい。既存の計画には含まれていない。',
      criterion: '.supervisor/ 配下にログ収集ツールを新規実装する',
      currentPlan: '対象外: .supervisor/ 配下の変更',
    });

    expect(result.verdict).toBe('mismatch');
    expect(result.sourceQuote).toBe('.supervisor/ 配下にログ収集ツールを新規実装してほしい');
  });

  test('過去の調査記録を背景とした記述は no_mismatch として扱われる', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'no_mismatch',
        sourceQuote: null,
        reason: '過去形の再現手順の記述であり将来の実装義務ではない',
      }),
    });

    const result = await reviewRequirementPlanMismatch({
      description: '再現手順として一時テストを追加し、確認後に撤去済みである。',
      criterion: '一時テストの追加手順どおりに動作する',
      currentPlan: '対象外: 監督の調査手順',
    });

    expect(result).toEqual({
      verdict: 'no_mismatch',
      sourceQuote: null,
      reason: '過去形の再現手順の記述であり将来の実装義務ではない',
    });
  });

  test('現在の計画が既に修正を許可している場合は no_mismatch', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'no_mismatch',
        sourceQuote: null,
        reason: '計画は既にこの基準への対応を含んでいる',
      }),
    });

    const result = await reviewRequirementPlanMismatch({
      description: '新しいエンドポイントを追加する',
      criterion: '新しいエンドポイントが動作する',
      currentPlan: '新しいエンドポイントの実装を含む',
    });

    expect(result.verdict).toBe('no_mismatch');
  });

  test('AIが返した sourceQuote が description 原文に存在しない場合は unknown へ格下げする', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'mismatch',
        sourceQuote: 'description に実在しない架空の引用文',
        reason: 'それらしい理由',
      }),
    });

    const result = await reviewRequirementPlanMismatch({
      description: '実際の説明文はこれだけで、架空の引用文とは無関係な内容である。',
      criterion: '任意の基準',
      currentPlan: '任意の計画',
    });

    expect(result.verdict).toBe('unknown');
    expect(result.sourceQuote).toBeNull();
    expect(result.reason).toBe('ungrounded_source_quote');
  });

  test('句読点・改行の表記揺れがあっても正規化して一致すれば mismatch を維持する', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'mismatch',
        sourceQuote: '新しいログ収集ツールを実装する。',
        reason: '明示的な要求がある',
      }),
    });

    const result = await reviewRequirementPlanMismatch({
      // 原文は句点なし・改行あり。AIの引用は句点付き・改行なし。
      description: '新しいログ収集ツールを実装する\n（詳細は別途）',
      criterion: '新しいログ収集ツールを実装する',
      currentPlan: '対象外',
    });

    expect(result.verdict).toBe('mismatch');
  });

  test('verdictがmismatch/no_mismatch以外の値なら unknown を返す', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ verdict: 'maybe', sourceQuote: null, reason: '不明' }),
    });

    const result = await reviewRequirementPlanMismatch({
      description: '説明',
      criterion: '基準',
      currentPlan: '計画',
    });

    expect(result.verdict).toBe('unknown');
  });

  test('AI応答にJSONが含まれない場合は unknown を返す', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'わかりません' });

    const result = await reviewRequirementPlanMismatch({
      description: '説明',
      criterion: '基準',
      currentPlan: '計画',
    });

    expect(result).toEqual({ verdict: 'unknown', sourceQuote: null, reason: 'parse_error' });
  });

  test('AI応答が不正なJSONの場合は unknown を返す', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: '{verdict: unquoted}' });

    const result = await reviewRequirementPlanMismatch({
      description: '説明',
      criterion: '基準',
      currentPlan: '計画',
    });

    expect(result.verdict).toBe('unknown');
  });

  test('AI呼び出しが例外を投げた場合は unknown を返し、呼び出し元に例外を伝播させない', async () => {
    mockSendAIMessage.mockRejectedValueOnce(new Error('API down'));

    const result = await reviewRequirementPlanMismatch({
      description: '説明',
      criterion: '基準',
      currentPlan: '計画',
    });

    expect(result).toEqual({ verdict: 'unknown', sourceQuote: null, reason: 'ai_error' });
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  test('descriptionが空でも呼び出せる（説明なし）', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ verdict: 'no_mismatch', sourceQuote: null, reason: '説明なし' }),
    });

    const result = await reviewRequirementPlanMismatch({
      description: '',
      criterion: '基準',
      currentPlan: '計画',
    });

    expect(result.verdict).toBe('no_mismatch');
    const callArgs = mockSendAIMessage.mock.calls[0][0] as { messages: { content: string }[] };
    expect(callArgs.messages[0].content).toContain('(説明なし)');
  });
});
