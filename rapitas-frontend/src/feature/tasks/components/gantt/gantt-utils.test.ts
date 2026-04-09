/**
 * gantt-utils.test.ts - Gantt ユーティリティ関数のテスト
 */

// NOTE: Frontend tests run under vitest, not bun:test (the backend uses bun:test).
import { describe, expect, test } from 'vitest';
import {
  dateToX,
  xToDate,
  taskToBar,
  arrowPath,
  arrowheadPath,
  adjustDateRange,
  getWeekGridLines,
  getDayGridLines,
  type GanttViewport
} from './gantt-utils';

describe('gantt-utils', () => {
  const mockViewport: GanttViewport = {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-31'),
    width: 800,
    height: 400,
    rowHeight: 40,
    margin: { top: 60, right: 40, bottom: 40, left: 200 }
  };

  describe('dateToX', () => {
    test('開始日は左マージン位置になる', () => {
      const x = dateToX(new Date('2024-01-01'), mockViewport);
      expect(x).toBe(200); // margin.left
    });

    test('終了日は右端位置になる', () => {
      const x = dateToX(new Date('2024-01-31'), mockViewport);
      const expectedX = 200 + (800 - 200 - 40); // left + chartWidth
      expect(x).toBe(expectedX);
    });

    test('中間日は適切な位置になる', () => {
      const x = dateToX(new Date('2024-01-16'), mockViewport); // 月の中央
      const expectedX = 200 + (800 - 200 - 40) / 2;
      expect(Math.abs(x - expectedX)).toBeLessThan(10); // 日数計算の誤差許容
    });

    test('範囲外の日付（過去）', () => {
      const x = dateToX(new Date('2023-12-31'), mockViewport);
      expect(x).toBeLessThanOrEqual(200); // 左マージン以下
    });
  });

  describe('xToDate', () => {
    test('左マージン位置は開始日になる', () => {
      const date = xToDate(200, mockViewport);
      expect(date.getTime()).toBeCloseTo(new Date('2024-01-01').getTime(), -2);
    });

    test('中央位置は中間日になる', () => {
      const midX = 200 + (800 - 200 - 40) / 2;
      const date = xToDate(midX, mockViewport);
      expect(date.getMonth()).toBe(0); // 1月
      expect(date.getDate()).toBeGreaterThan(10);
      expect(date.getDate()).toBeLessThan(20);
    });
  });

  describe('taskToBar', () => {
    test('期限ありタスクのバー生成', () => {
      const task = {
        id: 1,
        title: 'テストタスク',
        status: 'todo',
        dueDate: '2024-01-15',
        estimatedHours: 16, // 2日分
        theme: { color: '#FF0000' }
      };

      const bar = taskToBar(task, 0, mockViewport);

      expect(bar.taskId).toBe(1);
      expect(bar.title).toBe('テストタスク');
      expect(bar.y).toBe(60); // margin.top + 0 * rowHeight
      expect(bar.height).toBe(36); // rowHeight - 4
      expect(bar.width).toBeGreaterThan(20); // 最小幅
      expect(bar.color).toBe('#FF0000');
    });

    test('期限なしタスクのデフォルト期間', () => {
      const task = {
        id: 2,
        title: 'テストタスク2',
        status: 'in_progress',
        dueDate: null,
        estimatedHours: null
      };

      const bar = taskToBar(task, 1, mockViewport);

      expect(bar.taskId).toBe(2);
      expect(bar.y).toBe(100); // margin.top + 1 * rowHeight
      expect(bar.width).toBeGreaterThan(20);
      expect(bar.color).toBe('#3B82F6'); // in_progress color
    });

    test('完了タスクの色', () => {
      const task = {
        id: 3,
        title: 'テストタスク3',
        status: 'completed',
        dueDate: '2024-01-20'
      };

      const bar = taskToBar(task, 0, mockViewport);
      expect(bar.color).toBe('#10B981'); // completed color
    });

    test('ブロック中タスクの色', () => {
      const task = {
        id: 4,
        title: 'テストタスク4',
        status: 'blocked',
        dueDate: '2024-01-25'
      };

      const bar = taskToBar(task, 0, mockViewport);
      expect(bar.color).toBe('#F59E0B'); // blocked color
    });
  });

  describe('arrowPath', () => {
    test('矢印パスの生成', () => {
      const fromBar = {
        x: 200,
        y: 60,
        width: 100,
        height: 36,
        color: '#000',
        taskId: 1,
        title: 'From',
        status: 'completed'
      };

      const toBar = {
        x: 350,
        y: 100,
        width: 80,
        height: 36,
        color: '#000',
        taskId: 2,
        title: 'To',
        status: 'todo'
      };

      const path = arrowPath(fromBar, toBar);

      // SVG パス形式の基本チェック
      expect(path).toMatch(/^M \d+/); // M コマンドで開始
      expect(path).toContain('L '); // L コマンドを含む
      expect(path).toContain('300 78'); // fromBar の終点 (x + width, y + height/2)
      expect(path).toContain('342 118'); // toBar の開始点前 (x - 8, y + height/2)
    });
  });

  describe('arrowheadPath', () => {
    test('矢印の先端パス生成', () => {
      const toBar = {
        x: 350,
        y: 100,
        width: 80,
        height: 36,
        color: '#000',
        taskId: 1,
        title: 'To',
        status: 'todo'
      };

      const path = arrowheadPath(toBar);

      expect(path).toMatch(/^M \d+/);
      expect(path).toContain('350 118'); // toBar の中央点
      expect(path).toContain('342 114'); // 先端の上
      expect(path).toContain('342 122'); // 先端の下
    });
  });

  describe('adjustDateRange', () => {
    test('期限ありタスクの範囲調整', () => {
      const tasks = [
        { dueDate: '2024-01-15', estimatedHours: 8 },
        { dueDate: '2024-01-25', estimatedHours: 16 }
      ];

      const range = adjustDateRange(tasks);

      expect(range.start.getTime()).toBeLessThan(new Date('2024-01-14').getTime());
      expect(range.end.getTime()).toBeGreaterThan(new Date('2024-01-25').getTime());
    });

    test('期限なしタスクのデフォルト範囲', () => {
      const tasks = [
        { dueDate: null, estimatedHours: 8 }
      ];

      const range = adjustDateRange(tasks);
      const now = new Date();

      expect(range.start.getTime()).toBeLessThan(now.getTime());
      expect(range.end.getTime()).toBeGreaterThan(now.getTime());
    });

    test('空のタスク配列', () => {
      const range = adjustDateRange([]);
      const now = new Date();

      expect(range.start.getTime()).toBeLessThan(now.getTime());
      expect(range.end.getTime()).toBeGreaterThan(now.getTime());
    });

    test('カスタムマージン', () => {
      const tasks = [{ dueDate: '2024-01-15', estimatedHours: null }];
      const range = adjustDateRange(tasks, { before: 14, after: 14 });

      const baseDate = new Date('2024-01-15');
      const expectedStart = new Date(baseDate.getTime() - 14 * 24 * 60 * 60 * 1000);
      const expectedEnd = new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000);

      expect(Math.abs(range.start.getTime() - expectedStart.getTime())).toBeLessThan(24 * 60 * 60 * 1000);
      expect(Math.abs(range.end.getTime() - expectedEnd.getTime())).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  describe('getWeekGridLines', () => {
    test('週次グリッド線の計算', () => {
      const lines = getWeekGridLines(mockViewport);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(5); // 1月は最大5週
      lines.forEach(line => {
        expect(line).toBeGreaterThanOrEqual(200); // margin.left 以上
        expect(line).toBeLessThanOrEqual(760); // width - margin.right 以下
      });
    });
  });

  describe('getDayGridLines', () => {
    test('日次グリッド線の計算', () => {
      const lines = getDayGridLines(mockViewport);

      expect(lines.length).toBe(31); // 1月の日数
      lines.forEach(line => {
        expect(line).toBeGreaterThanOrEqual(200);
        expect(line).toBeLessThanOrEqual(760);
      });
    });
  });
});