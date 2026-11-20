/**
 * running-lines.test
 *
 * What ラピ's bubble says while agents run. It used to say only
 * 「エージェントが実行中です。」 (reported 2026-11-20): which task, and which
 * phase of it, was one click and a scroll away in the panel's chat.
 */
import { describe, it, expect } from 'vitest';
import { runningLines, RUNNING_LINES_MAX } from '../running-lines';
import type { ResumableExecution } from '@/components/resumable-executions/types';

const exec = (over: Partial<ResumableExecution>): ResumableExecution => ({
  id: 1,
  taskId: 10,
  taskTitle: 'タスク',
  sessionId: 1,
  status: 'running',
  claudeSessionId: null,
  errorMessage: null,
  output: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-11-20T00:00:00Z',
  workingDirectory: null,
  workflowStatus: 'draft',
  workflowMode: 'standard',
  canResume: false,
  ...over,
});

describe('the phase each line names', () => {
  it.each([
    ['draft', 'standard', 'researching'],
    ['research_done', 'standard', 'planning'],
    ['research_done', 'lightweight', 'implementing'],
    ['plan_approved', 'standard', 'implementing'],
    ['in_progress', 'standard', 'verifying'],
  ])('%s (%s) is %s', (workflowStatus, workflowMode, phase) => {
    const { lines } = runningLines([exec({ workflowStatus, workflowMode })]);
    expect(lines[0].phase).toBe(phase);
  });

  it('an execution waiting for an answer says so', () => {
    const { lines } = runningLines([exec({ status: 'waiting_for_input' })]);
    expect(lines[0].phase).toBe('awaitingAnswer');
  });

  it('a status it does not know names no phase rather than a wrong one', () => {
    const { lines } = runningLines([exec({ workflowStatus: null })]);
    expect(lines[0].phase).toBeNull();
  });
});

describe('which executions are lines', () => {
  it('only running ones — an interrupted one is not running', () => {
    const { lines } = runningLines([
      exec({ id: 1, taskTitle: '走っている' }),
      exec({ id: 2, status: 'interrupted', taskTitle: '止まった' }),
    ]);
    expect(lines.map((l) => l.title)).toEqual(['走っている']);
  });

  it('keeps the bubble short and counts the rest', () => {
    const many = Array.from({ length: RUNNING_LINES_MAX + 2 }, (_, i) =>
      exec({ id: i + 1, taskId: i + 1 }),
    );
    const { lines, more } = runningLines(many);
    expect(lines).toHaveLength(RUNNING_LINES_MAX);
    expect(more).toBe(2);
  });
});
