/**
 * critic-history ユニットテスト
 *
 * 遷移ログ→品質ゲート履歴表示モデルへの変換 (deriveCriticGateHistory) と
 * severity のバケット分け (severityBucket) を検証する。
 */
import {
  deriveCriticGateHistory,
  severityBucket,
  type RawWorkflowTransition,
} from '../critic-history';

describe('severityBucket', () => {
  it('returns high for scores >= 80', () => {
    expect(severityBucket(80)).toBe('high');
    expect(severityBucket(92)).toBe('high');
  });

  it('returns medium for scores >= 50 and < 80', () => {
    expect(severityBucket(50)).toBe('medium');
    expect(severityBucket(79)).toBe('medium');
  });

  it('returns low for scores below 50', () => {
    expect(severityBucket(0)).toBe('low');
    expect(severityBucket(49)).toBe('low');
  });

  it('returns null for null input', () => {
    expect(severityBucket(null)).toBeNull();
  });
});

describe('deriveCriticGateHistory', () => {
  it('maps the four critic causes to phase and type', () => {
    const transitions: RawWorkflowTransition[] = [
      {
        id: 1,
        cause: 'research_critic_failed',
        phase: 'research',
        createdAt: '2026-08-01T00:00:00Z',
      },
      { id: 2, cause: 'plan_critic_failed', phase: 'plan', createdAt: '2026-08-02T00:00:00Z' },
      {
        id: 3,
        cause: 'research_critic_exhausted',
        phase: 'research',
        createdAt: '2026-08-03T00:00:00Z',
      },
      { id: 4, cause: 'plan_critic_exhausted', phase: 'plan', createdAt: '2026-08-04T00:00:00Z' },
    ];
    const entries = deriveCriticGateHistory(transitions);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ id: 'critic-1', phase: 'research', type: 'bounced' });
    expect(entries[1]).toMatchObject({ id: 'critic-2', phase: 'plan', type: 'bounced' });
    expect(entries[2]).toMatchObject({ id: 'critic-3', phase: 'research', type: 'exhausted' });
    expect(entries[3]).toMatchObject({ id: 'critic-4', phase: 'plan', type: 'exhausted' });
  });

  it('excludes non-critic causes', () => {
    const transitions: RawWorkflowTransition[] = [
      { id: 1, cause: 'file_saved:research' },
      { id: 2, cause: null },
      { id: 3, cause: 'verify_validation_failed' },
    ];
    expect(deriveCriticGateHistory(transitions)).toHaveLength(0);
  });

  it('filters non-string reasons and nullifies non-numeric severity', () => {
    const transitions: RawWorkflowTransition[] = [
      {
        id: 5,
        cause: 'research_critic_failed',
        phase: 'research',
        metadata: { reasons: ['valid reason', 42, null, 'another reason'], severity: 'high' },
      },
      { id: 6, cause: 'plan_critic_failed', phase: 'plan', metadata: null },
    ];
    const entries = deriveCriticGateHistory(transitions);
    expect(entries[0].reasons).toEqual(['valid reason', 'another reason']);
    expect(entries[0].severity).toBeNull();
    expect(entries[1].reasons).toEqual([]);
    expect(entries[1].severity).toBeNull();
  });

  it('keeps numeric severity as-is', () => {
    const transitions: RawWorkflowTransition[] = [
      {
        id: 7,
        cause: 'plan_critic_failed',
        phase: 'plan',
        metadata: { severity: 65, reasons: [] },
      },
    ];
    expect(deriveCriticGateHistory(transitions)[0].severity).toBe(65);
  });

  it('falls back to the cause prefix when row.phase is out of contract', () => {
    const transitions: RawWorkflowTransition[] = [
      { id: 8, cause: 'plan_critic_failed', phase: 'implement' },
      { id: 9, cause: 'research_critic_exhausted', phase: null },
    ];
    const entries = deriveCriticGateHistory(transitions);
    expect(entries[0].phase).toBe('plan');
    expect(entries[1].phase).toBe('research');
  });

  it('generates a unique id from the array index when the row has no id', () => {
    const transitions: RawWorkflowTransition[] = [
      { cause: 'research_critic_failed', phase: 'research' },
      { cause: 'plan_critic_failed', phase: 'plan' },
    ];
    const entries = deriveCriticGateHistory(transitions);
    expect(entries[0].id).toBe('critic-0');
    expect(entries[1].id).toBe('critic-1');
    expect(entries[0].id).not.toBe(entries[1].id);
  });
});
