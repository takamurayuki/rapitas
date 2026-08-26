/**
 * diagnose-error テスト
 *
 * マスク適用（PII混入時は生のメールアドレスがLLMへ渡らないこと）/
 * RAPITAS_AUX_AI=off 時のスキップ / errorBlob 空文字時のスキップ /
 * CLI呼び出し失敗・JSON解析失敗時の非throw非記録 / 正常系の信頼度クランプと
 * suggestedAction 検証を確認する。risk-assessor/mitigate は実実装を使う
 * （マスク処理自体の正しさは pii-risk 側の既存テストが担保する）。
 * NOTE: mock.module はプロセスグローバル。
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

const callClaudeCliMock = mock((..._args: unknown[]) => Promise.resolve({ content: '{}' }));
const getAuxAiModeMock = mock(() => 'cli' as 'cli' | 'api' | 'off');
mock.module('../../../utils/ai-client', () => ({
  getAuxAiMode: getAuxAiModeMock,
  callClaudeCli: callClaudeCliMock,
}));

const recordDiagnosisMock = mock((..._args: unknown[]) => {});
mock.module('./error-diagnosis-recorder', () => ({
  recordDiagnosis: recordDiagnosisMock,
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { diagnoseErrorWithLlm } = await import('./diagnose-error');

const BASE_INPUT = {
  taskId: 612,
  phase: 'manual',
  fromProvider: 'openai',
  fromModel: 'gpt-5',
};

const VALID_LLM_JSON = JSON.stringify({
  rootCause: 'connection reset by peer',
  confidence: 70,
  suggestedAction: 'retry',
  reasoning: 'transient network blip',
});

describe('diagnoseErrorWithLlm', () => {
  beforeEach(() => {
    callClaudeCliMock.mockClear();
    callClaudeCliMock.mockImplementation(() => Promise.resolve({ content: VALID_LLM_JSON }));
    getAuxAiModeMock.mockClear();
    getAuxAiModeMock.mockImplementation(() => 'cli');
    recordDiagnosisMock.mockClear();
  });

  test('PII混入時: 生のメールアドレスがLLMへ渡らずマスクされる', async () => {
    const errorBlob = 'Failed to reach a@example.com and b@example.com — connection reset';
    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob });

    expect(callClaudeCliMock).toHaveBeenCalledTimes(1);
    const [, messages] = callClaudeCliMock.mock.calls[0] as [unknown, { content: string }[]];
    expect(messages[0].content).not.toContain('a@example.com');
    expect(messages[0].content).not.toContain('b@example.com');
    expect(messages[0].content).toContain('[REDACTED:EMAIL]');
  });

  test('errorBlob が空文字ならLLMを呼び出さない', async () => {
    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: '   ' });

    expect(callClaudeCliMock).not.toHaveBeenCalled();
    expect(recordDiagnosisMock).not.toHaveBeenCalled();
  });

  test('RAPITAS_AUX_AI=off の場合はLLMを呼び出さない', async () => {
    getAuxAiModeMock.mockImplementation(() => 'off');

    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' });

    expect(callClaudeCliMock).not.toHaveBeenCalled();
    expect(recordDiagnosisMock).not.toHaveBeenCalled();
  });

  test('CLI呼び出し自体が失敗しても throw せず記録もしない', async () => {
    callClaudeCliMock.mockImplementation(() => Promise.reject(new Error('cli timeout')));

    await expect(
      diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' }),
    ).resolves.toBeUndefined();
    expect(recordDiagnosisMock).not.toHaveBeenCalled();
  });

  test('LLM応答がJSONとして解析不能でも throw せず記録もしない', async () => {
    callClaudeCliMock.mockImplementation(() => Promise.resolve({ content: 'not json at all' }));

    await expect(
      diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' }),
    ).resolves.toBeUndefined();
    expect(recordDiagnosisMock).not.toHaveBeenCalled();
  });

  test('必須フィールド欠落時は記録しない', async () => {
    callClaudeCliMock.mockImplementation(() =>
      Promise.resolve({ content: JSON.stringify({ confidence: 50 }) }),
    );

    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' });

    expect(recordDiagnosisMock).not.toHaveBeenCalled();
  });

  test('正常系: 信頼度が範囲外[0,100]ならクランプし、suggestedActionが未知ならno_actionに丸める', async () => {
    callClaudeCliMock.mockImplementation(() =>
      Promise.resolve({
        content: JSON.stringify({
          rootCause: 'unknown provider fault',
          confidence: 150,
          suggestedAction: 'sabotage',
          reasoning: 'made up reasoning',
        }),
      }),
    );

    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' });

    expect(recordDiagnosisMock).toHaveBeenCalledTimes(1);
    const recorded = recordDiagnosisMock.mock.calls[0][0] as {
      confidence: number;
      suggestedAction: string;
    };
    expect(recorded.confidence).toBe(100);
    expect(recorded.suggestedAction).toBe('no_action');
  });

  test('正常系: 有効な応答はそのまま記録される', async () => {
    await diagnoseErrorWithLlm({ ...BASE_INPUT, errorBlob: 'some error' });

    expect(recordDiagnosisMock).toHaveBeenCalledTimes(1);
    const recorded = recordDiagnosisMock.mock.calls[0][0] as Record<string, unknown>;
    expect(recorded).toMatchObject({
      taskId: 612,
      phase: 'manual',
      fromProvider: 'openai',
      fromModel: 'gpt-5',
      rootCause: 'connection reset by peer',
      confidence: 70,
      suggestedAction: 'retry',
      reasoning: 'transient network blip',
    });
  });
});
