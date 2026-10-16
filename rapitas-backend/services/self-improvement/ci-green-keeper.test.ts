/**
 * ci-green-keeper.test
 *
 * Unit tests for the pure latest-per-workflow failure picker. The gh-CLI /
 * prisma shell (runCiWatch) is exercised operationally via the backlog job.
 */
import { describe, it, expect } from 'bun:test';
import { pickFailingWorkflows, type CiRun } from './ci-green-keeper';

function run(over: Partial<CiRun>): CiRun {
  return {
    databaseId: 1,
    workflowName: 'Test and Lint',
    status: 'completed',
    conclusion: 'success',
    ...over,
  };
}

describe('pickFailingWorkflows', () => {
  it('returns the newest completed run per workflow when it failed', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, conclusion: 'failure' }),
      run({ databaseId: 9, conclusion: 'success' }), // older run of same workflow
      run({ databaseId: 8, workflowName: 'Build Tauri App', conclusion: 'success' }),
    ]);
    expect(failing.map((r) => r.databaseId)).toEqual([10]);
  });

  it('ignores a red run that a newer green run has superseded', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, conclusion: 'success' }),
      run({ databaseId: 9, conclusion: 'failure' }),
    ]);
    expect(failing).toEqual([]);
  });

  it('skips in-progress runs and judges the previous completed one', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 11, status: 'in_progress', conclusion: null }),
      run({ databaseId: 10, conclusion: 'failure' }),
    ]);
    expect(failing.map((r) => r.databaseId)).toEqual([10]);
  });

  it('counts timed_out as failing and ignores cancelled', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, workflowName: 'A', conclusion: 'timed_out' }),
      run({ databaseId: 9, workflowName: 'B', conclusion: 'cancelled' }),
    ]);
    expect(failing.map((r) => r.workflowName)).toEqual(['A']);
  });
});
