/**
 * concern-search-score.test.ts
 *
 * Verifies the derived impactScore / priority / pattern / relatedTasks values.
 */
import { describe, it, expect } from 'bun:test';
import {
  toPriority,
  countRelatedTasks,
  computeImpactScore,
  renderPattern,
  toSearchItem,
} from './concern-search-score';

describe('concern-search-score', () => {
  it('maps severity to display priority', () => {
    expect(toPriority('urgent')).toBe('Critical');
    expect(toPriority('high')).toBe('High');
    expect(toPriority('medium')).toBe('Medium');
    expect(toPriority('low')).toBe('Low');
  });

  it('counts non-null related task ids', () => {
    expect(countRelatedTasks({ originTaskId: null, createdTaskId: null })).toBe(0);
    expect(countRelatedTasks({ originTaskId: 1, createdTaskId: null })).toBe(1);
    expect(countRelatedTasks({ originTaskId: 1, createdTaskId: 2 })).toBe(2);
  });

  it('computes impactScore for every severity x related-task combination', () => {
    const base = { urgent: 8.5, high: 6.5, medium: 4.0, low: 2.0 } as const;
    for (const sev of Object.keys(base) as (keyof typeof base)[]) {
      for (const n of [0, 1, 2]) {
        expect(computeImpactScore(sev, n)).toBe(Math.round((base[sev] + n * 0.3) * 10) / 10);
      }
    }
    expect(computeImpactScore('urgent', 2)).toBe(9.1);
    expect(computeImpactScore('urgent', 100)).toBe(10);
  });

  it('renders a 3-cell pattern', () => {
    expect(renderPattern('Critical')).toBe('⬛⬛⬛');
    expect(renderPattern('High')).toBe('⬛⬛⬜');
    expect(renderPattern('Medium')).toBe('⬛⬜⬜');
    expect(renderPattern('Low')).toBe('⬜⬜⬜');
  });

  it('builds the 6-key search item', () => {
    const item = toSearchItem({
      id: 5,
      title: 't',
      severity: 'urgent',
      originTaskId: 1,
      createdTaskId: 2,
    });
    expect(item).toEqual({
      id: 5,
      title: 't',
      impactScore: 9.1,
      relatedTasks: 2,
      priority: 'Critical',
      pattern: '⬛⬛⬛',
    });
  });
});
