/**
 * prefer-test-each-for-similar
 *
 * Detects multiple `it`/`test` calls within the same describe scope that share
 * a long common string prefix, suggesting they could be consolidated with test.each.
 *
 * Severity: `warn` (non-blocking). The intent is to encourage refactoring, not block CI.
 * To escalate to `error`, update the severity in `eslint.config.mjs`.
 *
 * NOTE: Register this rule only in the test-file block of `eslint.config.mjs`, never
 * in the prod block.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        '同一 describe スコープ内に共通プレフィックスを持つ it/test が並んでいる場合、test.each への統合を提案する',
      recommended: false,
    },
    messages: {
      preferTestEach:
        '同一構造の it が {{count}} 件あります。test.each への統合を検討してください（共通: "{{prefix}}"）',
    },
    schema: [
      {
        type: 'object',
        properties: {
          minCount: {
            type: 'integer',
            minimum: 2,
            default: 3,
          },
          minPrefixLength: {
            type: 'integer',
            minimum: 1,
            default: 8,
          },
        },
        additionalProperties: false,
      },
    ],
    fixable: null,
  },

  /**
   * Creates the rule visitor.
   *
   * @param {import('eslint').Rule.RuleContext} context - ESLint rule context
   * @returns {import('eslint').Rule.RuleListener} AST visitor
   */
  create(context) {
    const options = context.options[0] || {};
    const minCount = options.minCount ?? 3;
    const minPrefixLength = options.minPrefixLength ?? 8;

    /**
     * Stack of describe scope frames.
     * Each frame: { callback: FunctionNode, entries: Array<{desc: string, node: CallExpression}> }
     *
     * NOTE: LIFO order ensures nested describe scopes never cross-contaminate each other.
     */
    const scopeStack = [];

    /**
     * Compute the longest common prefix of two strings.
     *
     * @param {string} a
     * @param {string} b
     * @returns {string}
     */
    function lcp(a, b) {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    }

    /**
     * Analyze collected entries and report consecutive groups that share a long common prefix.
     * Groups run sequentially (no skipping); an unrelated it in between breaks the group.
     *
     * @param {Array<{desc: string, node: import('eslint').Rule.Node}>} entries
     */
    function analyzeFrame(entries) {
      if (entries.length < minCount) return;

      let groupStart = 0;
      while (groupStart < entries.length) {
        if (groupStart + 1 >= entries.length) break;

        // Seed the running prefix from the first adjacent pair
        let currentPrefix = lcp(entries[groupStart].desc, entries[groupStart + 1].desc);

        if (currentPrefix.length < minPrefixLength) {
          groupStart++;
          continue;
        }

        // Extend the group while the running LCP stays above the threshold
        let groupEnd = groupStart + 1;
        while (groupEnd + 1 < entries.length) {
          const extended = lcp(currentPrefix, entries[groupEnd + 1].desc);
          if (extended.length >= minPrefixLength) {
            currentPrefix = extended;
            groupEnd++;
          } else {
            break;
          }
        }

        const groupSize = groupEnd - groupStart + 1;
        if (groupSize >= minCount) {
          // NOTE: Report only the first node in the group to minimise warning noise.
          context.report({
            node: entries[groupStart].node,
            messageId: 'preferTestEach',
            data: {
              count: String(groupSize),
              prefix: currentPrefix,
            },
          });
        }

        groupStart = groupEnd + 1;
      }
    }

    /**
     * Returns true when the CallExpression is a describe() or describe.X() call.
     *
     * @param {import('eslint').Rule.Node} node
     * @returns {boolean}
     */
    function isDescribeCall(node) {
      const callee = node.callee;
      if (callee.type === 'Identifier') return callee.name === 'describe';
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
        return callee.object.name === 'describe';
      }
      return false;
    }

    /**
     * Returns true when the CallExpression is a plain it() or test() — not .each/.skip/.todo/.only.
     * Those variants have a MemberExpression callee and are already consolidated or intentionally skipped.
     *
     * @param {import('eslint').Rule.Node} node
     * @returns {boolean}
     */
    function isPlainItOrTest(node) {
      return (
        node.callee.type === 'Identifier' &&
        (node.callee.name === 'it' || node.callee.name === 'test')
      );
    }

    return {
      CallExpression(node) {
        if (isDescribeCall(node)) {
          const lastArg = node.arguments[node.arguments.length - 1];
          if (
            lastArg &&
            (lastArg.type === 'FunctionExpression' || lastArg.type === 'ArrowFunctionExpression')
          ) {
            scopeStack.push({ callback: lastArg, entries: [] });
          }
          return;
        }

        if (isPlainItOrTest(node) && scopeStack.length > 0) {
          const firstArg = node.arguments[0];
          if (firstArg && firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
            scopeStack[scopeStack.length - 1].entries.push({ desc: firstArg.value, node });
          }
        }
      },

      'CallExpression:exit'(node) {
        if (!isDescribeCall(node) || scopeStack.length === 0) return;

        const lastArg = node.arguments[node.arguments.length - 1];
        const frame = scopeStack[scopeStack.length - 1];
        // Match the exact callback node to handle multiple sibling describes correctly
        if (lastArg && frame.callback === lastArg) {
          analyzeFrame(frame.entries);
          scopeStack.pop();
        }
      },
    };
  },
};

export default rule;
