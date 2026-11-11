/**
 * roadmap-commit companion tests (companion design 4.3 / stage 1 acceptance 5)
 *
 * Every task a roadmap commit creates is accompanied and carries its criteria
 * in the column — including when the loop stops partway: a plan of three that
 * fails after the second still leaves the two it made with their rows, because
 * each row is part of its own task's insert, not a final step that never runs.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let inputs: Record<string, unknown>[] = [];
let nextId = 200;
let failOnTaskNumber: number | null = null;
let taskCount = 0;

mock.module('../../config/database', () => ({
  prisma: {
    theme: { create: async () => ({ id: nextId++ }) },
    project: { create: async () => ({ id: nextId++ }) },
  },
  ensureDatabaseConnection: async () => {},
}));

mock.module('../task/task-mutations', () => ({
  createTask: async (_p: unknown, input: Record<string, unknown>) => {
    taskCount += 1;
    if (failOnTaskNumber === taskCount) throw new Error('db went away');
    inputs.push(input);
    return { id: nextId++, ...input };
  },
}));

const { commitRoadmap } = await import('./roadmap-commit');

const step = (n: number) => ({
  title: `手順${n}`,
  description: `やること${n}`,
  acceptanceCriteria: [`手順${n}が終わっている`],
});

const PLAN = {
  goal: '三つの手順で終える',
  themeChoice: { kind: 'existing' as const, id: 1, name: 'rapitas' },
  projectChoice: { kind: 'none' as const },
  steps: [step(1), step(2), step(3)],
};

beforeEach(() => {
  inputs = [];
  nextId = 200;
  failOnTaskNumber = null;
  taskCount = 0;
});

describe('roadmap tasks are accompanied', () => {
  test('stopping after the second of three: both created tasks have a companion row', async () => {
    failOnTaskNumber = 3;
    const out = await commitRoadmap(PLAN);
    expect(out.failedAfter).toBe(2);
    expect(out.taskIds).toEqual([200, 201]);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.companion).toEqual({ origin: 'roadmap_commit' });
    }
  });

  test('each task carries its own approved criteria in the column', async () => {
    await commitRoadmap(PLAN);
    expect(inputs.map((i) => i.acceptanceCriteria)).toEqual([
      ['手順1が終わっている'],
      ['手順2が終わっている'],
      ['手順3が終わっている'],
    ]);
  });
});
