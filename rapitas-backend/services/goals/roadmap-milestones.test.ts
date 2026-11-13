/**
 * roadmap-milestones.test
 *
 * How ラピ's drafted milestones (節目) are read: each needs a name and
 * checkable criteria, dates follow the same deadline rule as steps, and a
 * step's milestone number is kept only when it points at a real milestone.
 */
import { describe, expect, test } from 'bun:test';
import {
  MAX_ROADMAP_MILESTONES,
  resolveRoadmapMilestones,
  stepMilestoneIndexes,
} from './roadmap-milestones';

const TODAY = new Date('2026-11-14T00:00:00Z');

describe('resolveRoadmapMilestones', () => {
  test('keeps named milestones with their criteria, cleaned', () => {
    expect(
      resolveRoadmapMilestones(
        [
          { name: '基礎固め', done: [' 午前問題で7割 ', '', '午前問題で7割', '過去問3年分'] },
          { name: '  ', done: ['名前のない節目は捨てる'] },
          { name: '仕上げ', done: [] },
        ],
        { today: TODAY },
      ),
    ).toEqual([
      { name: '基礎固め', acceptanceCriteria: ['午前問題で7割', '過去問3年分'] },
      { name: '仕上げ', acceptanceCriteria: [] },
    ]);
  });

  test('dates a milestone only when the request named a deadline, never past it', () => {
    const raw = [
      { name: 'A', done: ['x'], dueInDays: 10 },
      { name: 'B', done: ['y'], dueInDays: 400 },
    ];
    expect(resolveRoadmapMilestones(raw, { today: TODAY })).toEqual([
      { name: 'A', acceptanceCriteria: ['x'] },
      { name: 'B', acceptanceCriteria: ['y'] },
    ]);
    expect(resolveRoadmapMilestones(raw, { today: TODAY, deadlineInDays: 30 })).toEqual([
      { name: 'A', acceptanceCriteria: ['x'], dueDate: '2026-11-24' },
      { name: 'B', acceptanceCriteria: ['y'], dueDate: '2026-12-14' },
    ]);
  });

  test.each([undefined, null, 'x', {}])('reads %p as no milestones', (raw) => {
    expect(resolveRoadmapMilestones(raw, { today: TODAY })).toEqual([]);
  });

  test('is bounded', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `M${i}`, done: ['x'] }));
    expect(resolveRoadmapMilestones(many, { today: TODAY })).toHaveLength(MAX_ROADMAP_MILESTONES);
  });
});

describe('stepMilestoneIndexes', () => {
  test('keeps a step milestone number only when it names an existing milestone', () => {
    const rawSteps = [
      { title: 'a', milestone: 0 },
      { title: 'b', milestone: 1 },
      { title: 'c', milestone: 2 },
      { title: 'd', milestone: '1' },
      { title: 'e', milestone: -1 },
      { title: 'f' },
    ];
    expect(stepMilestoneIndexes(rawSteps, 2)).toEqual([
      0,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('has nothing to point at without milestones', () => {
    expect(stepMilestoneIndexes([{ title: 'a', milestone: 0 }], 0)).toEqual([undefined]);
  });

  test('follows only the steps that became steps (untitled raw steps are dropped)', () => {
    const rawSteps = [
      { title: '', milestone: 0 },
      { title: 'b', milestone: 1 },
    ];
    expect(stepMilestoneIndexes(rawSteps, 2)).toEqual([1]);
  });
});
