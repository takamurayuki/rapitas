/**
 * workflow-memory-render.usefulness.test
 *
 * Covers ranking by an entry's own recall record. Separate file from the
 * context tests because bun's mock.module is process-global and this needs the
 * real ranking function.
 */
import { describe, test, expect } from 'bun:test';
import {
  applyOutcomeWeighting,
  USEFULNESS_MIN_OBSERVATIONS,
  type MemoryEntry,
} from './workflow-memory-render';

const entry = (id: number, title: string, similarity = 0.5): MemoryEntry => ({
  id,
  title,
  content: `content-${id}`,
  category: 'lesson',
  similarity,
});

const record = (injected: number, used: number) => ({
  injected,
  used,
  rate: injected > 0 ? used / injected : 0,
});

describe('applyOutcomeWeighting — recall record', () => {
  test('an entry agents actually use outranks one they never do', () => {
    const entries = [entry(1, 'never used'), entry(2, 'always used')];
    const usefulness = new Map([
      [1, record(5, 0)],
      [2, record(5, 5)],
    ]);

    const ranked = applyOutcomeWeighting(entries, new Map(), usefulness);

    expect(ranked.map((e) => e.id)).toEqual([2, 1]);
  });

  test('an entry with no record is not penalised — it is new, not useless', () => {
    // Absence of evidence must never read as evidence of uselessness, or
    // nothing newly learned would ever surface again.
    const entries = [entry(1, 'unknown'), entry(2, 'proven')];
    const withRecord = new Map([[2, record(5, 5)]]);

    const rankedNoData = applyOutcomeWeighting([entry(1, 'unknown')], new Map(), new Map());
    const rankedAlone = applyOutcomeWeighting([entry(1, 'unknown')], new Map());

    // Same entry, same position, with and without the map.
    expect(rankedNoData[0].id).toBe(rankedAlone[0].id);
    // And a proven entry still wins on merit, not by the other being pushed down.
    expect(applyOutcomeWeighting(entries, new Map(), withRecord)[0].id).toBe(2);
  });

  test('thin evidence does not move anything', () => {
    const thin = USEFULNESS_MIN_OBSERVATIONS - 1;
    const entries = [entry(1, 'a', 0.6), entry(2, 'b', 0.5)];
    const usefulness = new Map([[1, record(thin, 0)]]);

    // Entry 1 has a 0% rate but too few observations, so similarity still rules.
    expect(applyOutcomeWeighting(entries, new Map(), usefulness).map((e) => e.id)).toEqual([1, 2]);
  });

  test('the record cannot outweigh a large similarity gap on its own', () => {
    // The multiplier is deliberately gentle: relevance to THIS task still leads.
    const entries = [entry(1, 'very relevant', 1.0), entry(2, 'barely relevant', 0.2)];
    const usefulness = new Map([
      [1, record(5, 0)],
      [2, record(5, 5)],
    ]);

    expect(applyOutcomeWeighting(entries, new Map(), usefulness)[0].id).toBe(1);
  });
});
