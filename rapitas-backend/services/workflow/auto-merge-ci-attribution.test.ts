/**
 * auto-merge-ci-attribution.test
 *
 * Inherited-vs-own attribution of failing PR checks against the base branch.
 */
import { describe, test, expect } from 'bun:test';
import {
  latestCompletedPerWorkflow,
  readBaseFailingJobs,
  splitInheritedFailures,
} from './auto-merge-ci-attribution';

describe('latestCompletedPerWorkflow', () => {
  test('keeps only the newest completed run of each workflow', () => {
    const runs = [
      { databaseId: 3, workflowName: 'Test and Lint', status: 'in_progress', conclusion: null },
      { databaseId: 2, workflowName: 'Test and Lint', status: 'completed', conclusion: 'failure' },
      { databaseId: 1, workflowName: 'Test and Lint', status: 'completed', conclusion: 'success' },
      { databaseId: 9, workflowName: 'Gitleaks', status: 'completed', conclusion: 'success' },
    ];
    expect(latestCompletedPerWorkflow(runs).map((r) => r.databaseId)).toEqual([2, 9]);
  });
});

describe('readBaseFailingJobs', () => {
  test('collects failing job names from the latest failed run of each workflow', async () => {
    const calls: string[] = [];
    const run = async (command: string) => {
      calls.push(command);
      if (command.includes('run list')) {
        return JSON.stringify([
          {
            databaseId: 11,
            workflowName: 'Test and Lint',
            status: 'completed',
            conclusion: 'failure',
          },
          { databaseId: 12, workflowName: 'Build', status: 'completed', conclusion: 'success' },
        ]);
      }
      return JSON.stringify({
        jobs: [
          { name: 'Test Backend', conclusion: 'failure' },
          { name: 'Lint Code', conclusion: 'success' },
          { name: 'Check Frontend', conclusion: 'failure' },
        ],
      });
    };
    const failing = await readBaseFailingJobs('C:/repo', 'develop', run);
    expect([...failing].sort()).toEqual(['Check Frontend', 'Test Backend']);
    // Only the failed run is inspected — the green Build run costs no gh call.
    expect(calls.filter((c) => c.includes('run view'))).toHaveLength(1);
    expect(calls[0]).toContain('--branch "develop"');
  });

  test("fails open (empty set) when gh errors, so the failure stays the PR's", async () => {
    const run = async () => {
      throw new Error('gh: not logged in');
    };
    expect((await readBaseFailingJobs('C:/repo', 'develop', run)).size).toBe(0);
  });
});

describe('splitInheritedFailures', () => {
  test("separates checks that also fail on base from the PR's own", () => {
    const result = splitInheritedFailures(
      ['Test Backend', 'Enforce per-file line limits (with ratchet baseline)'],
      new Set(['Test Backend']),
    );
    expect(result.inherited).toEqual(['Test Backend']);
    expect(result.own).toEqual(['Enforce per-file line limits (with ratchet baseline)']);
  });
});
