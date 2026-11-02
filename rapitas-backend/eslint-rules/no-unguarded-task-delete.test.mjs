/**
 * no-unguarded-task-delete.test.mjs
 *
 * Unit tests for the no-unguarded-task-delete ESLint rule.
 *
 * Strategy follows no-unscoped-pr-number-lookup.test.mjs: `Linter.verify()`
 * inside each `it()`, because `RuleTester.run()` calls `describe()` which
 * bun:test forbids inside an `it()` callback.
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import rule from './no-unguarded-task-delete.mjs';

/**
 * Runs the rule against `code` and returns the array of lint messages.
 *
 * @param {string} code - source to lint / 対象ソース
 * @returns {import('eslint').Linter.LintMessage[]} messages / 検出結果
 */
function runRule(code) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { local: { rules: { 'no-unguarded-task-delete': rule } } },
    rules: { 'local/no-unguarded-task-delete': 'error' },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  });
}

describe('no-unguarded-task-delete — reports a direct delete', () => {
  // Each of these shapes was a real bypass closed in #1330.
  it.each([
    ['prisma.task.delete', `await prisma.task.delete({ where: { id: taskId } });`],
    ['prisma.task.deleteMany', `await prisma.task.deleteMany({ where: { id: { in: ids } } });`],
    ['a transaction client', `await tx.task.delete({ where: { id } });`],
    ['a nested client path', `await ctx.db.task.deleteMany({ where: { parentId: id } });`],
  ])('%s', (_label, code) => {
    const msgs = runRule(code);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unguardedDelete');
  });

  it('names the method in the message so the fix is obvious', () => {
    const msgs = runRule(`prisma.task.deleteMany({ where: {} });`);
    expect(msgs[0].message).toContain('deleteMany');
  });

  it('reports every call site, not just the first', () => {
    const msgs = runRule(`prisma.task.delete({ where: { id: 1 } });
prisma.task.delete({ where: { id: 2 } });`);
    expect(msgs).toHaveLength(2);
  });
});

describe('no-unguarded-task-delete — leaves everything else alone', () => {
  it.each([
    ['the guarded helper', `await deleteTaskWithTrash(taskId, 'user');`],
    ['the bulk guarded helper', `await deleteTasksWithTrash(ids, 'user');`],
    ['a delete on another model', `await prisma.taskLabel.deleteMany({ where: { taskId } });`],
    ['a model whose name merely ends in task', `await prisma.subtask.delete({ where: { id } });`],
    ['a non-delete method on task', `await prisma.task.update({ where: { id }, data: {} });`],
    ['a findMany on task', `await prisma.task.findMany({ where: { parentId: null } });`],
    ['a bare function called delete', `await deleteMany(ids);`],
    // The delegate reached through a variable is deliberately not matched —
    // the rule is a guardrail, not a proof, and a false positive on an
    // unrelated `.delete` would push people to disable it.
    ['a delegate held in a variable', `const d = prisma.task; await d.delete({ where: { id } });`],
  ])('%s', (_label, code) => {
    expect(runRule(code)).toHaveLength(0);
  });
});
