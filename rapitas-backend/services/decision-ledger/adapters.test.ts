/**
 * decision-ledger/adapters.test
 *
 * Covers the projections from the three storage tables into one vocabulary. The
 * load-bearing rule under test is that anything unjudgeable comes out as
 * `indeterminate` rather than being folded into right or wrong.
 */
import { describe, test, expect } from 'bun:test';
import { fromDecisionTrace, kindFromNodeKey } from './from-decision-trace';
import { fromLearningRecord, judgeLearningRecord, DURATION_BAND } from './from-learning-record';
import { fromDecisionLog } from './from-decision-log';

const AT = new Date('2026-08-25T15:17:00Z');

const trace = (over: Record<string, unknown> = {}) => ({
  id: 480,
  taskId: 666,
  nodeKey: 'task666:model-route:1787672867337',
  summary: 'モデル選択: claude-sonnet-5',
  adoptedId: 'claude-sonnet-5',
  adoptedReason: '複雑度58（中）に基づきstandardモデルを推奨',
  consistency: 'consistent',
  consistencyNote: '実行が正常完了',
  createdAt: AT,
  ...over,
});

const record = (over: Record<string, unknown> = {}) => ({
  id: 2750,
  taskId: 666,
  workflowMode: 'standard',
  predictedComplexity: 40,
  estimatedDuration: 76,
  actualDurationMinutes: 60,
  outcome: 'completed',
  success: true,
  createdAt: AT,
  ...over,
});

describe('fromDecisionTrace', () => {
  test('carries the reason across as the basis, not just the choice', () => {
    const d = fromDecisionTrace(trace());
    expect(d.id).toBe('trace:480');
    expect(d.kind).toBe('model_tier');
    expect(d.verdict).toBe('correct');
    expect(d.basis).toContain('複雑度58');
    expect(d.predicted).toEqual({ adopted: 'claude-sonnet-5' });
  });

  test('a skipped check is unjudgeable, never wrong', () => {
    expect(fromDecisionTrace(trace({ consistency: 'skipped' })).verdict).toBe('indeterminate');
  });

  test('an unrecognised state stays pending rather than counting as judged', () => {
    expect(fromDecisionTrace(trace({ consistency: 'weird' })).verdict).toBe('pending');
  });

  test('reads the kind out of the nodeKey', () => {
    expect(kindFromNodeKey('task1:risk-floor:9')).toBe('risk_floor');
    expect(kindFromNodeKey('task1:knowledge-recall:9')).toBe('knowledge_use');
    // Historical rows predate every kind but the first.
    expect(kindFromNodeKey('malformed')).toBe('model_tier');
  });

  test('names the role the decision was about, not just what was picked', () => {
    const d = fromDecisionTrace(
      trace({ inputMasked: JSON.stringify({ role: 'implementer', tier: 'premium' }) }),
    );
    expect(d.subject).toBe('implementer phase');
    expect(d.predicted).toEqual({
      adopted: 'claude-sonnet-5',
      tier: 'premium',
      role: 'implementer',
    });
  });

  test('rows predating the role stay readable instead of collapsing to blank', () => {
    expect(fromDecisionTrace(trace({ inputMasked: null })).subject).toBe(
      'モデル選択: claude-sonnet-5',
    );
  });

  test('a malformed audit row degrades rather than breaking the whole read', () => {
    const d = fromDecisionTrace(trace({ inputMasked: '{not json' }));
    expect(d.subject).toBe('モデル選択: claude-sonnet-5');
    expect(d.predicted).toEqual({ adopted: 'claude-sonnet-5' });
  });

  test('namespaces ids so two tables cannot collide on one number', () => {
    expect(fromDecisionTrace(trace({ id: 1 })).id).not.toBe(
      fromLearningRecord(record({ id: 1 })).id,
    );
  });
});

describe('judgeLearningRecord', () => {
  test('within the band is correct', () => {
    expect(judgeLearningRecord(record({ actualDurationMinutes: 76 }))).toBe('correct');
  });

  test('outside the band is partial — it finished, the estimate was off', () => {
    const overrun = record({ estimatedDuration: 10, actualDurationMinutes: 100 });
    expect(100 / 10).toBeGreaterThan(DURATION_BAND.upper);
    expect(judgeLearningRecord(overrun)).toBe('partial');
  });

  test('a failed run says nothing about the mode chosen for it', () => {
    expect(judgeLearningRecord(record({ success: false, outcome: 'failed' }))).toBe(
      'indeterminate',
    );
  });

  test('a row with no prediction cannot be judged', () => {
    expect(judgeLearningRecord(record({ predictedComplexity: null }))).toBe('indeterminate');
  });

  test('a run still in flight is pending, not correct', () => {
    expect(judgeLearningRecord(record({ actualDurationMinutes: null }))).toBe('pending');
  });

  test('a missing estimate leaves the mode partially judged, never wrong', () => {
    expect(judgeLearningRecord(record({ estimatedDuration: null }))).toBe('partial');
  });
});

describe('fromLearningRecord', () => {
  test('keeps prediction and outcome side by side', () => {
    const d = fromLearningRecord(record());
    expect(d.kind).toBe('workflow_mode');
    expect(d.predicted).toEqual({ complexity: 40, mode: 'standard', estimatedMinutes: 76 });
    expect(d.outcome).toEqual({ actualMinutes: 60, outcome: 'completed' });
  });

  test('says so plainly when nothing was predicted', () => {
    expect(fromLearningRecord(record({ predictedComplexity: null })).basis).toBe(
      '予測が記録されていない',
    );
  });
});

describe('fromDecisionLog', () => {
  const logRow = {
    id: 12,
    taskId: 601,
    decision: '計画を承認',
    context: '検証が通ったため',
    rationale: null,
    predictedOutcome: '差し戻しなく完了する',
    confidence: 0.7,
    actualOutcome: '完了した',
    calibration: 'correct',
    createdAt: AT,
  };

  test('falls back to context when no rationale was written', () => {
    const d = fromDecisionLog(logRow);
    expect(d.kind).toBe('plan_approval');
    expect(d.basis).toBe('検証が通ったため');
    expect(d.verdict).toBe('correct');
  });

  test('an unreviewed decision is pending', () => {
    expect(fromDecisionLog({ ...logRow, calibration: 'pending' }).verdict).toBe('pending');
  });
});
