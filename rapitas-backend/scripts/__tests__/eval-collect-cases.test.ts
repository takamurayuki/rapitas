/**
 * eval-collect-cases.test
 *
 * Unit tests for the pure helpers in eval-collect-cases.ts. The Prisma
 * dependency is injected via a minimal fake matching CandidateTaskSource, so
 * no real DB connection is required.
 */
import { describe, it, expect } from 'bun:test';
import {
  estimateCategory,
  fetchCandidateTasks,
  buildCandidates,
  type CandidateTaskRow,
} from '../eval-collect-cases';

describe('estimateCategory', () => {
  it('detects investigation-only from Japanese keyword', () => {
    expect(estimateCategory('原因調査', null)).toBe('investigation-only');
  });

  it('detects bug-fix from English keyword', () => {
    expect(estimateCategory('fix: crash on startup', null)).toBe('bug-fix');
  });

  it('detects failure-recovery from description', () => {
    expect(estimateCategory('some task', '差し戻しからの復旧')).toBe('failure-recovery');
  });

  it('falls back to feature when nothing matches', () => {
    expect(estimateCategory('untitled task', null)).toBe('feature');
  });
});

describe('fetchCandidateTasks', () => {
  it('queries done tasks with a linked github PR', async () => {
    const rows: CandidateTaskRow[] = [
      { id: 1, title: 'fix bug', description: null, status: 'done' },
    ];
    let capturedArgs: unknown;
    const fakePrisma = {
      task: {
        findMany: async (args: unknown) => {
          capturedArgs = args;
          return rows;
        },
      },
    };

    const result = await fetchCandidateTasks(fakePrisma, 10);

    expect(result).toEqual(rows);
    expect((capturedArgs as { where: { status: string } }).where.status).toBe('done');
    expect((capturedArgs as { take: number }).take).toBe(10);
  });
});

describe('buildCandidates', () => {
  it('maps task rows to candidate case shells', () => {
    const rows: CandidateTaskRow[] = [
      { id: 42, title: 'Add feature X', description: 'detail', status: 'done' },
    ];
    const candidates = buildCandidates(rows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('task-42');
    expect(candidates[0].taskDescription).toBe('detail');
    expect(candidates[0].expectedOutcome).toBe('fail-to-pass');
  });

  it('falls back to title when description is null', () => {
    const rows: CandidateTaskRow[] = [
      { id: 7, title: 'Only a title', description: null, status: 'done' },
    ];
    const candidates = buildCandidates(rows);
    expect(candidates[0].taskDescription).toBe('Only a title');
  });
});
