/**
 * requirement-intake-cap.test
 *
 * Covers which tasks count against the outstanding-backlog cap.
 *
 * Measured 2026-10-17: all six of ContextFlow's unstarted tasks were
 * `autoRunExcluded`, so its headroom was permanently zero and its eight screen
 * tasks could never be filed — and because screens gate features, the theme
 * filed nothing at all with no way out that did not involve a human.
 */
import { describe, test, expect } from 'bun:test';
import { unstartedTaskFilter } from './requirement-intake-job';

describe('unstartedTaskFilter', () => {
  test('leaves out tasks auto-run will never select', () => {
    // The cap keeps filing proportional to THROUGHPUT; an excluded task is not
    // in the pipeline, so counting it only removes headroom that never returns.
    expect(unstartedTaskFilter(35).autoRunExcluded).toBe(false);
  });

  test('counts both unstarted statuses', () => {
    expect(unstartedTaskFilter(35).status.in).toEqual(['todo', 'draft']);
  });

  test('is scoped to the theme', () => {
    expect(unstartedTaskFilter(35).themeId).toBe(35);
    expect(unstartedTaskFilter(34).themeId).toBe(34);
  });

  test('names no other condition, so nothing else silently narrows the count', () => {
    expect(Object.keys(unstartedTaskFilter(1)).sort()).toEqual([
      'autoRunExcluded',
      'status',
      'themeId',
    ]);
  });
});
