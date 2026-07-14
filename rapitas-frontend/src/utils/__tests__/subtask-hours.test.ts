/**
 * subtask-hours.test
 *
 * Verifies subtask work-time aggregation, including the null fallback
 * contract used by parent-task displays.
 */

import { describe, it, expect } from 'vitest';
import { sumSubtaskActualHours } from '../subtask-hours';
import type { Task } from '@/types';

const makeSubtask = (id: number, actualHours: number | null): Task => ({
  id,
  title: `Subtask ${id}`,
  status: 'todo',
  priority: 'medium',
  actualHours: actualHours ?? undefined,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('sumSubtaskActualHours', () => {
  it('作業時間が登録されたサブタスクの合計を返す', () => {
    const subtasks = [makeSubtask(1, 1.5), makeSubtask(2, 2), makeSubtask(3, null)];
    expect(sumSubtaskActualHours(subtasks)).toBe(3.5);
  });

  it('どのサブタスクにも作業時間が無ければnullを返す', () => {
    expect(sumSubtaskActualHours([makeSubtask(1, null), makeSubtask(2, null)])).toBeNull();
  });

  it('サブタスクが空/未ロードならnullを返す', () => {
    expect(sumSubtaskActualHours([])).toBeNull();
    expect(sumSubtaskActualHours(undefined)).toBeNull();
    expect(sumSubtaskActualHours(null)).toBeNull();
  });

  it('作業時間0のサブタスクも「登録あり」として合計に含める', () => {
    expect(sumSubtaskActualHours([makeSubtask(1, 0)])).toBe(0);
  });
});
