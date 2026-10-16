/**
 * error-diagnosis-aggregator テスト
 *
 * 0件 / フィードバックなし / 混在の3パターンで NaN が発生しないこと、
 * および confidence 平均・feedbackRate・helpfulRate の算出を検証する。
 * 純関数のため mock 不要。
 */
import { describe, test, expect } from 'bun:test';
import { aggregate } from './error-diagnosis-aggregator';
import type { DiagnosisFeedbackRecord, DiagnosisRecord } from './error-diagnosis.types';

function makeDiagnosis(overrides: Partial<DiagnosisRecord> = {}): DiagnosisRecord {
  return {
    id: 'diag-1',
    tsMs: 1000,
    taskId: 612,
    phase: 'manual',
    fromProvider: 'openai',
    fromModel: 'gpt-5',
    rootCause: 'connection reset',
    confidence: 50,
    suggestedAction: 'retry',
    reasoning: 'transient blip',
    llmLatencyMs: 1000,
    llmModel: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<DiagnosisFeedbackRecord> = {}): DiagnosisFeedbackRecord {
  return {
    id: 'fb-1',
    diagnosisId: 'diag-1',
    tsMs: 1000,
    helpful: true,
    note: null,
    ...overrides,
  };
}

describe('error-diagnosis-aggregator', () => {
  test('0件: 全指標が0でNaNが発生しない', () => {
    expect(aggregate([], [])).toEqual({
      total: 0,
      avgConfidence: 0,
      feedbackRate: 0,
      helpfulRate: 0,
    });
  });

  test('フィードバックなし: feedbackRate/helpfulRateは0、avgConfidenceのみ算出', () => {
    const diagnoses = [
      makeDiagnosis({ id: 'a', confidence: 40 }),
      makeDiagnosis({ id: 'b', confidence: 80 }),
    ];

    const summary = aggregate(diagnoses, []);

    expect(summary).toEqual({
      total: 2,
      avgConfidence: 60,
      feedbackRate: 0,
      helpfulRate: 0,
    });
  });

  test('混在: 一部診断にのみフィードバックがある場合のfeedbackRate/helpfulRate', () => {
    const diagnoses = [
      makeDiagnosis({ id: 'a', confidence: 60 }),
      makeDiagnosis({ id: 'b', confidence: 80 }),
      makeDiagnosis({ id: 'c', confidence: 100 }),
    ];
    const feedback = [
      makeFeedback({ id: 'fb-a', diagnosisId: 'a', helpful: true }),
      makeFeedback({ id: 'fb-b', diagnosisId: 'b', helpful: false }),
      // 'c' has no feedback; a feedback for an unrelated (out-of-window) diagnosis id is ignored
      makeFeedback({ id: 'fb-x', diagnosisId: 'z', helpful: true }),
    ];

    const summary = aggregate(diagnoses, feedback);

    expect(summary.total).toBe(3);
    expect(summary.avgConfidence).toBeCloseTo(80);
    expect(summary.feedbackRate).toBeCloseTo(2 / 3);
    expect(summary.helpfulRate).toBeCloseTo(0.5);
  });
});
