/**
 * no-raw-prisma-insensitive
 *
 * Detects raw `{ mode: 'insensitive' }` literals in Prisma query objects and
 * reports them as errors. SQLite does not support `mode: 'insensitive'` and
 * will throw a PrismaClientValidationError at runtime.
 *
 * Use `getInsensitiveMode()` from `config/db-provider.ts` instead, which
 * returns `{ mode: 'insensitive' }` for PostgreSQL and `{}` for SQLite.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow raw `mode: 'insensitive'` in Prisma queries — use getInsensitiveMode() from config/db-provider.ts instead",
      recommended: true,
    },
    messages: {
      rawInsensitive:
        "生の `mode: 'insensitive'` は SQLite で実行時エラーになります。config/db-provider.ts の getInsensitiveMode() を spread してください。",
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
       * Check each `Property` node. Report when:
       * - key is `mode` (Identifier or string Literal)
       * - value is the string literal `'insensitive'`
       *
       * NOTE: Both conditions must match to avoid false positives from
       * other `mode` properties unrelated to Prisma StringFilter.
       */
      Property(node) {
        const keyName =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? String(node.key.value)
              : null;

        if (keyName !== 'mode') return;

        // Direct string literal: { mode: 'insensitive' }
        if (node.value.type === 'Literal' && node.value.value === 'insensitive') {
          context.report({ node, messageId: 'rawInsensitive' });
          return;
        }

        // TypeScript `as const` cast: { mode: 'insensitive' as const }
        // @typescript-eslint/parser wraps the literal in a TSAsExpression node.
        if (
          node.value.type === 'TSAsExpression' &&
          node.value.expression?.type === 'Literal' &&
          node.value.expression.value === 'insensitive'
        ) {
          context.report({ node, messageId: 'rawInsensitive' });
        }
      },
    };
  },
};

export default rule;
