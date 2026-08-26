/**
 * error-diagnosis-recorder テスト
 *
 * never-throw 保証（診断記録は store 例外を握り潰す）/ nowMs→tsMs マップ /
 * テスト環境ガード（RAPITAS_DATA_DIR 未指定時は記録しない）/
 * フィードバック記録の基本動作を検証する。
 * NOTE: mock.module はプロセスグローバル — store の実装は本ファイル内では
 * 常にモックされ、実ファイルへは書き込まない。
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { DiagnosisFeedbackRecord, DiagnosisRecord } from './error-diagnosis.types';

const appendDiagnosisMock = mock((_record: DiagnosisRecord) => {});
const appendFeedbackMock = mock((_record: DiagnosisFeedbackRecord) => {});
mock.module('./error-diagnosis-store', () => ({
  appendDiagnosis: appendDiagnosisMock,
  readDiagnoses: mock(() => []),
  appendFeedback: appendFeedbackMock,
  readFeedback: mock(() => []),
  diagnosesFilePath: mock(() => '/tmp/diagnoses.jsonl'),
  feedbackFilePath: mock(() => '/tmp/feedback.jsonl'),
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { recordDiagnosis, recordFeedback } = await import('./error-diagnosis-recorder');

const DIAGNOSIS_INPUT = {
  taskId: 612,
  phase: 'manual',
  fromProvider: 'openai',
  fromModel: 'gpt-5',
  rootCause: 'connection reset by peer',
  confidence: 70,
  suggestedAction: 'retry' as const,
  reasoning: 'transient network blip',
  llmLatencyMs: 5000,
  llmModel: 'claude-haiku-4-5-20251001',
};

describe('recordDiagnosis', () => {
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    appendDiagnosisMock.mockClear();
    appendDiagnosisMock.mockImplementation(() => {});
    process.env.RAPITAS_DATA_DIR = '/tmp/error-diagnosis-test';
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
  });

  test('nowMs が tsMs に採用され、入力フィールドがそのまま保存される', () => {
    recordDiagnosis(DIAGNOSIS_INPUT, 123_456);

    expect(appendDiagnosisMock).toHaveBeenCalledTimes(1);
    const saved = appendDiagnosisMock.mock.calls[0][0];
    expect(saved.tsMs).toBe(123_456);
    expect(typeof saved.id).toBe('string');
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved).toMatchObject(DIAGNOSIS_INPUT);
  });

  test('store が例外を投げても throw しない（never throw）', () => {
    appendDiagnosisMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => recordDiagnosis(DIAGNOSIS_INPUT, 1)).not.toThrow();
  });

  test('NODE_ENV=test かつ RAPITAS_DATA_DIR 未指定なら記録しない（テスト混入ガード）', () => {
    delete process.env.RAPITAS_DATA_DIR;

    recordDiagnosis(DIAGNOSIS_INPUT, 1);

    expect(appendDiagnosisMock).not.toHaveBeenCalled();
  });
});

describe('recordFeedback', () => {
  beforeEach(() => {
    appendFeedbackMock.mockClear();
  });

  test('nowMs が tsMs に採用され、入力フィールドがそのまま保存される', () => {
    recordFeedback({ diagnosisId: 'diag-1', helpful: true, note: 'helped a lot' }, 999);

    expect(appendFeedbackMock).toHaveBeenCalledTimes(1);
    const saved = appendFeedbackMock.mock.calls[0][0];
    expect(saved.tsMs).toBe(999);
    expect(typeof saved.id).toBe('string');
    expect(saved).toMatchObject({
      diagnosisId: 'diag-1',
      helpful: true,
      note: 'helped a lot',
    });
  });
});
