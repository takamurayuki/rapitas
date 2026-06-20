/**
 * workflow-rejected-plan-context.test
 *
 * Unit tests for the pure rejection-reason rendering.
 */
import { describe, it, expect } from 'bun:test';
import { renderRejectedPlans, type RejectedPlan } from './workflow-rejected-plan-context';

describe('renderRejectedPlans', () => {
  it('returns empty string with no items', () => {
    expect(renderRejectedPlans([], 'ja')).toBe('');
  });

  it('lists each rejection with its task title and reason', () => {
    const items: RejectedPlan[] = [
      { taskTitle: 'Add login', reason: 'セキュリティ監査が不足' },
      { taskTitle: 'Refactor API', reason: 'スコープが広すぎる' },
    ];
    const md = renderRejectedPlans(items, 'ja');
    expect(md).toContain('却下された計画');
    expect(md).toContain('Add login');
    expect(md).toContain('セキュリティ監査が不足');
    expect(md).toContain('Refactor API');
    expect(md).toContain('スコープが広すぎる');
  });

  it('renders an English header for en', () => {
    const md = renderRejectedPlans([{ taskTitle: 'T', reason: 'r' }], 'en');
    expect(md).toContain('Previously Rejected Plans');
  });
});
