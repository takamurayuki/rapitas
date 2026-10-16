/**
 * header/__tests__/types.test.ts
 *
 * Unit tests for pure utility functions in header/types.ts.
 * Tests checkIsTaskDetailPage boundary values, lineStyle CSS variable output,
 * and getLineDelay calculation correctness.
 */

import { describe, it, expect } from 'vitest';
import {
  checkIsTaskDetailPage,
  lineStyle,
  getLineDelay,
  LINE_ANIMATION_DURATION,
  LINE_STAGGER,
  LINE_DELAY_STEP,
} from '../types';

describe('checkIsTaskDetailPage', () => {
  describe('returns false', () => {
    it('for null', () => {
      expect(checkIsTaskDetailPage(null)).toBe(false);
    });

    it('for empty string', () => {
      expect(checkIsTaskDetailPage('')).toBe(false);
    });

    it('for root path /', () => {
      expect(checkIsTaskDetailPage('/')).toBe(false);
    });

    it('for /tasks without id segment', () => {
      expect(checkIsTaskDetailPage('/tasks')).toBe(false);
    });

    it('for /tasks/new (excluded by design)', () => {
      expect(checkIsTaskDetailPage('/tasks/new')).toBe(false);
    });

    it('for /dashboard', () => {
      expect(checkIsTaskDetailPage('/dashboard')).toBe(false);
    });

    it('for /kanban', () => {
      expect(checkIsTaskDetailPage('/kanban')).toBe(false);
    });

    it('for /tasks/123/edit (nested path with extra segment)', () => {
      // Regex requires exactly one non-slash segment after /tasks/
      expect(checkIsTaskDetailPage('/tasks/123/edit')).toBe(false);
    });
  });

  describe('returns true', () => {
    it('for /tasks/123 (numeric id)', () => {
      expect(checkIsTaskDetailPage('/tasks/123')).toBe(true);
    });

    it('for /tasks/abc-def (slug id)', () => {
      expect(checkIsTaskDetailPage('/tasks/abc-def')).toBe(true);
    });

    it('for /task-detail exactly', () => {
      expect(checkIsTaskDetailPage('/task-detail')).toBe(true);
    });

    it('for /task-detail/123', () => {
      expect(checkIsTaskDetailPage('/task-detail/123')).toBe(true);
    });

    it('for /tasks/detail exactly', () => {
      expect(checkIsTaskDetailPage('/tasks/detail')).toBe(true);
    });

    it('for /tasks/detail/123', () => {
      expect(checkIsTaskDetailPage('/tasks/detail/123')).toBe(true);
    });
  });
});

describe('lineStyle', () => {
  it('includes the correct --line-duration from LINE_ANIMATION_DURATION', () => {
    const style = lineStyle('0.08s');
    expect(style['--line-duration']).toBe(`${LINE_ANIMATION_DURATION}s`);
  });

  it('includes the correct --line-stagger from LINE_STAGGER', () => {
    const style = lineStyle('0.08s');
    expect(style['--line-stagger']).toBe(`${LINE_STAGGER}s`);
  });

  it('includes the provided delay as --line-delay', () => {
    const style = lineStyle('0.16s');
    expect(style['--line-delay']).toBe('0.16s');
  });

  it('accepts "0s" as a valid delay', () => {
    const style = lineStyle('0s');
    expect(style['--line-delay']).toBe('0s');
  });
});

describe('getLineDelay', () => {
  it('returns "0.000s" for depth=0, order=0', () => {
    expect(getLineDelay(0, 0)).toBe('0.000s');
  });

  it('returns correct value for depth=1, order=0', () => {
    const expected = `${(1 * LINE_DELAY_STEP).toFixed(3)}s`;
    expect(getLineDelay(1, 0)).toBe(expected);
  });

  it('returns correct value for depth=0, order=1', () => {
    const expected = `${(1 * LINE_DELAY_STEP).toFixed(3)}s`;
    expect(getLineDelay(0, 1)).toBe(expected);
  });

  it('sums depth and order with LINE_DELAY_STEP', () => {
    const expected = `${(3 * LINE_DELAY_STEP).toFixed(3)}s`;
    expect(getLineDelay(2, 1)).toBe(expected);
  });

  it('produces 3 decimal places in the output', () => {
    const result = getLineDelay(1, 2);
    expect(result).toMatch(/^\d+\.\d{3}s$/);
  });
});
