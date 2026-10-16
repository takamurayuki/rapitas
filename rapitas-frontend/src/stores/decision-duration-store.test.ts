import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDecisionDurationStore } from './decision-duration-store';

const MIN = 60_000;

describe('useDecisionDurationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useDecisionDurationStore.getState().clear();
  });

  it('keeps durations separate per kind', () => {
    const { record } = useDecisionDurationStore.getState();
    record('a', MIN);
    record('b', 2 * MIN);
    expect(useDecisionDurationStore.getState().durations).toEqual({ a: [MIN], b: [2 * MIN] });
  });

  it('caps at 10 per kind and ignores invalid values', () => {
    const { record } = useDecisionDurationStore.getState();
    for (let i = 1; i <= 11; i++) record('a', i * MIN);
    record('a', 1);
    const list = useDecisionDurationStore.getState().durations.a;
    expect(list).toHaveLength(10);
    expect(list[0]).toBe(2 * MIN);
  });

  it('persists to localStorage and never calls fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    useDecisionDurationStore.getState().record('a', MIN);
    expect(localStorage.getItem('rapitas-decision-durations')).toContain('"a":[60000]');
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    fetchSpy.mockRestore();
  });

  it('drops corrupt persisted values on rehydrate', async () => {
    localStorage.setItem(
      'rapitas-decision-durations',
      JSON.stringify({ state: { durations: { a: [MIN, 'x', null, -1], b: 'bad' } }, version: 1 }),
    );
    await useDecisionDurationStore.persist.rehydrate();
    expect(useDecisionDurationStore.getState().durations).toEqual({ a: [MIN] });
  });
});
