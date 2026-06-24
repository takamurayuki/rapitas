/**
 * prefer-test-each-for-similar
 *
 * Detects test/it blocks where all body statements follow the pattern
 * `expect(FN(ARG)).MATCHER(VAL)` with the same FN identifier (3+ occurrences),
 * suggesting they can be collapsed into a test.each call.
 *
 * Only fires when every statement in the callback body matches the expect form.
 * Mixed-statement blocks (e.g., setup variables + expects) are not flagged.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        '同一関数を複数引数で繰り返す expect は test.each にまとめることを推奨します',
      recommended: false,
    },
    messages: {
      preferEach:
        '同一関数 `{{fn}}` を {{count}} 回繰り返す expect が検出されました。test.each([...]) にまとめることを推奨します。',
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
       * Check each CallExpression node. Report when:
       * - callee is the bare identifier `it` or `test` (not `it.each`, `test.only`, etc.)
       * - second argument is an arrow function or function expression
       * - ALL body statements are ExpressionStatements in expect(FN(ARG)).MATCHER(VAL) form
       * - at least one FN identifier appears 3+ times
       *
       * NOTE: Early `return` inside the loop exits the visitor for this node without
       * reporting — this is intentional for the "mixed statements" valid case.
       */
      CallExpression(node) {
        // Only target bare `it(...)` and `test(...)` — skip member expressions like `it.each`
        if (node.callee.type !== 'Identifier') return;
        const calleeName = node.callee.name;
        if (calleeName !== 'it' && calleeName !== 'test') return;

        // Second argument must be an arrow function or function expression
        const callback = node.arguments[1];
        if (!callback) return;
        if (
          callback.type !== 'ArrowFunctionExpression' &&
          callback.type !== 'FunctionExpression'
        ) {
          return;
        }

        // Body must be a BlockStatement
        if (!callback.body || callback.body.type !== 'BlockStatement') return;
        const statements = callback.body.body;
        if (statements.length < 3) return;

        /** @type {Map<string, number>} Occurrence count per FN name */
        const fnCounts = new Map();

        for (const stmt of statements) {
          // Any non-ExpressionStatement (e.g., VariableDeclaration) → stop, don't report
          if (stmt.type !== 'ExpressionStatement') return;

          const expr = stmt.expression;

          // Outer call: .MATCHER(VAL)
          if (expr.type !== 'CallExpression') return;
          if (expr.callee.type !== 'MemberExpression') return;

          // Object of member: expect(FN(ARG))
          const expectCall = expr.callee.object;
          if (expectCall.type !== 'CallExpression') return;
          if (
            expectCall.callee.type !== 'Identifier' ||
            expectCall.callee.name !== 'expect'
          ) {
            return;
          }

          // Argument to expect: FN(ARG) where FN is a simple identifier
          const innerCall = expectCall.arguments[0];
          if (!innerCall || innerCall.type !== 'CallExpression') return;
          if (innerCall.callee.type !== 'Identifier') return;

          const fnName = innerCall.callee.name;
          fnCounts.set(fnName, (fnCounts.get(fnName) ?? 0) + 1);
        }

        // Report the first FN that appears 3+ times (report once per block)
        for (const [fn, count] of fnCounts) {
          if (count >= 3) {
            context.report({
              node,
              messageId: 'preferEach',
              data: { fn, count: String(count) },
            });
            return;
          }
        }
      },
    };
  },
};

export default rule;
