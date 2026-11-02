/**
 * no-unguarded-task-delete
 *
 * Detects `<obj>.task.delete(...)` / `<obj>.task.deleteMany(...)` — a Prisma
 * delete on the Task delegate written anywhere other than the deletion choke
 * point.
 *
 * Deleting a task means four things besides removing the row: refusing when it
 * is marked protected, clearing its worktrees, writing a trash copy so it can
 * be restored, and copying the measurements out before a 43-relation cascade
 * takes them. `services/task/task-deletion.ts` does all four.
 *
 * Every path that skipped it has lost data. The #1330 review found three
 * (the bulk routes, the duplicate-subtask sweeps, PATCH label replacement) and
 * a fourth was found while fixing them: the completed-task prune removed 921
 * tasks with no trash copy. Counting on each new caller to remember is what
 * produced those four, so this is a lint error rather than a convention.
 *
 * NOT covered (fail-open by design — a guardrail, not a proof):
 * - a delegate reached through a variable (`const d = prisma.task; d.delete()`)
 * - raw SQL (`$executeRaw`) and `$transaction` callbacks that alias the client
 * - cascading deletes from a parent row, which are the database's business
 * - test files, which mock the client and must be able to assert on it
 */

/** Prisma delete methods on a model delegate. */
const DELETE_METHODS = new Set(['delete', 'deleteMany']);

/**
 * Resolves a static property key / member name.
 *
 * @param {import('estree').Node} node - Identifier or Literal node / 対象ノード
 * @returns {string | null} the name, or null when computed / 静的に解決できない場合は null
 */
function staticName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow prisma.task.delete / deleteMany outside services/task/task-deletion.ts — use deleteTaskWithTrash / deleteTasksWithTrash so the protected check, the trash copy and the measurement snapshot cannot be skipped',
      recommended: true,
    },
    messages: {
      unguardedDelete:
        'Task を直接 {{method}} しています。保護フラグの確認・ゴミ箱への退避・計測値の退避がすべて飛ばされます（#1330 でこの迂回を4箇所見つけ、うち1箇所は921件をゴミ箱無しで削除していました）。services/task/task-deletion.ts の deleteTaskWithTrash() / deleteTasksWithTrash() を使ってください。',
    },
    schema: [],
    fixable: null,
  },

  /**
   * Creates the rule visitor.
   *
   * @param {import('eslint').Rule.RuleContext} context - ESLint rule context
   * @returns {import('eslint').Rule.RuleListener} AST visitor
   */
  create(context) {
    return {
      /**
       * Reports `<anything>.task.delete(...)` and `.deleteMany(...)`.
       *
       * @param {import('estree').CallExpression} node - the call / 呼び出しノード
       */
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;

        const method = staticName(callee.property);
        if (!method || !DELETE_METHODS.has(method)) return;

        // The object the method hangs off must itself be `<something>.task`.
        const delegate = callee.object;
        if (delegate.type !== 'MemberExpression' || delegate.computed) return;
        if (staticName(delegate.property) !== 'task') return;

        context.report({ node, messageId: 'unguardedDelete', data: { method } });
      },
    };
  },
};

export default rule;
