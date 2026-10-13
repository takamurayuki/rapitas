import { describe, expect, test } from 'bun:test';
import { buildStructuredPrompt } from './prompt-builder';
import type { AgentTask } from '../base-agent';

describe('workflow upload transport isolation', () => {
  for (const analysisInfo of [
    undefined,
    {
      summary: 'Verify current changes',
      complexity: 'medium' as const,
      estimatedTotalHours: 1,
      subtasks: [],
      reasoning: 'Regression check',
    },
  ]) {
    test(`fresh paths for repeated runs (${analysisInfo ? 'analysis' : 'simple'})`, () => {
      const task: AgentTask = { id: 911, title: 'Verify repair', analysisInfo };
      const first = buildStructuredPrompt(task, 'C:/work/task-911', '[test]');
      const second = buildStructuredPrompt(task, 'C:/work/task-911', '[test]');
      const paths = (prompt: string) =>
        [...prompt.matchAll(/C:\/work\/task-911\/\.wf-[0-9a-f-]+\.md/g)].map((m) => m[0]);
      expect(paths(first).length).toBeGreaterThanOrEqual(2);
      expect(new Set(paths(first)).size).toBe(1);
      expect(new Set(paths(second)).size).toBe(1);
      expect(paths(first)[0]).not.toBe(paths(second)[0]);
      expect(first).not.toContain('.wf-tmp.md');
      expect(first).toContain('current code and current task requirements');
      expect(first).toContain('interrupted or rejected reports are stale evidence');
    });
  }
});

describe('Working Directory primary note (task 1200)', () => {
  const PRIMARY = 'C:/repo/primary';
  const task: AgentTask = { id: 1200, title: 't' };

  test('adds the worktree-first note when workDir is the primary checkout', () => {
    for (const t of [task, { ...task, optimizedPrompt: 'do it' }]) {
      const prompt = buildStructuredPrompt(t, 'C:\\repo\\primary\\', '[test]', PRIMARY);
      expect(prompt).toContain('primary checkout');
      expect(prompt).toContain('never `cd` to it');
      expect(prompt).toContain('cd <primary>/rapitas-backend');
      expect(prompt).toContain('relative `cd rapitas-backend`');
    }
  });

  test('leaves the output unchanged for a task worktree', () => {
    const wt = `${PRIMARY}/.worktrees/task-1200-abc`;
    const prompt = buildStructuredPrompt(task, wt, '[test]', PRIMARY);
    expect(prompt).not.toContain('never `cd` to it');
  });
});
