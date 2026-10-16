/**
 * repair-stagnation ユニットテスト
 *
 * 遷移ログ→修復反復エントリへの変換 (deriveRepairIterations) と
 * 閾値判定 (hasReachedStagnationThreshold) を検証する。
 */
import {
  deriveRepairIterations,
  hasReachedStagnationThreshold,
  STAGNATION_ITERATION_THRESHOLD,
  type RawRepairTransition,
} from '../repair-stagnation';

describe('deriveRepairIterations', () => {
  it('collects verify_repair and ci_repair rows in chronological order', () => {
    const transitions: RawRepairTransition[] = [
      { id: 1, cause: 'verify_repair', createdAt: '2026-08-01T00:00:00Z' },
      { id: 2, cause: 'ci_repair', createdAt: '2026-08-02T00:00:00Z' },
      { id: 3, cause: 'verify_repair', createdAt: '2026-08-03T00:00:00Z' },
    ];
    const entries = deriveRepairIterations(transitions);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ id: 'repair-1', cause: 'verify_repair' });
    expect(entries[1]).toMatchObject({ id: 'repair-2', cause: 'ci_repair' });
    expect(entries[2]).toMatchObject({ id: 'repair-3', cause: 'verify_repair' });
  });

  it('excludes non-repair causes', () => {
    const transitions: RawRepairTransition[] = [
      { id: 1, cause: 'file_saved:verify' },
      { id: 2, cause: null },
      { id: 3, cause: 'research_critic_failed' },
    ];
    expect(deriveRepairIterations(transitions)).toHaveLength(0);
  });

  it('generates a unique id from the array index when the row has no id', () => {
    const transitions: RawRepairTransition[] = [{ cause: 'verify_repair' }, { cause: 'ci_repair' }];
    const entries = deriveRepairIterations(transitions);
    expect(entries[0].id).toBe('repair-0');
    expect(entries[1].id).toBe('repair-1');
    expect(entries[0].id).not.toBe(entries[1].id);
  });
});

describe('hasReachedStagnationThreshold', () => {
  it('returns false below the threshold', () => {
    expect(hasReachedStagnationThreshold(0)).toBe(false);
    expect(hasReachedStagnationThreshold(STAGNATION_ITERATION_THRESHOLD - 1)).toBe(false);
  });

  it('returns true at and above the threshold', () => {
    expect(hasReachedStagnationThreshold(STAGNATION_ITERATION_THRESHOLD)).toBe(true);
    expect(hasReachedStagnationThreshold(STAGNATION_ITERATION_THRESHOLD + 5)).toBe(true);
  });
});
