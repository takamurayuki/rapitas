/**
 * no-unscoped-pr-number-lookup
 *
 * Detects `prNumber` used without a sibling `integrationId` inside the `where`
 * object of any `<obj>.gitHubPullRequest.<method>(...)` Prisma query call.
 * `GitHubPullRequest` stores PRs from ALL integrations in one table and
 * `prNumber` is only unique per repository (`@@unique([integrationId, prNumber])`),
 * so an unscoped lookup can silently return a same-numbered PR from another
 * repository (incident 28e4d983 / task #596).
 *
 * NOT covered (fail-open by design — this rule is a guardrail, not a proof):
 * - `select` / `data` / log payloads and any object outside a `where` value
 * - other models (only the `gitHubPullRequest` delegate is inspected)
 * - spread siblings (`where: { ...scope, prNumber }`) — scope may come from the spread
 * - `where` passed as a variable reference (`findFirst({ where })`)
 */

/**
 * Resolves a static property key name from a Property node.
 *
 * @param {import('estree').Property} prop - object property node / 対象プロパティ
 * @returns {string | null} key name, or null when computed/non-static / 静的に解決できない場合は null
 */
function propKeyName(prop) {
  if (prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow prNumber without a sibling integrationId in gitHubPullRequest where clauses — use findScopedOpenPr() from services/github/pr-lookup.ts instead',
      recommended: true,
    },
    messages: {
      unscopedPrNumber:
        'gitHubPullRequest の where で prNumber を integrationId 無しに指定しています。prNumber はリポジトリ内でのみ一意です（別リポジトリの同番号PRを取り違えます）。services/github/pr-lookup.ts の findScopedOpenPr() を使うか、where に integrationId を同居させてください。',
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
    /**
     * Recursively walks every ObjectExpression under a `where` value
     * (through nested objects and OR/AND/NOT arrays) and reports each
     * `prNumber` property whose OWN object has neither a sibling
     * `integrationId` property nor a SpreadElement.
     *
     * NOTE: The sibling check is per-object, NOT ancestor-based — the composite
     * key `integrationId_prNumber: { integrationId, prNumber }` must pass because
     * both keys live in the same inner object, while `OR: [{ prNumber }]` must
     * still be reported for the inner object alone.
     *
     * @param {import('estree').Node} node - subtree root / 走査対象ノード
     * @returns {void}
     */
    function checkWhereSubtree(node) {
      if (!node) return;

      if (node.type === 'ObjectExpression') {
        const hasSpread = node.properties.some((p) => p.type === 'SpreadElement');
        const hasIntegrationId = node.properties.some(
          (p) => p.type === 'Property' && propKeyName(p) === 'integrationId',
        );

        for (const prop of node.properties) {
          if (prop.type !== 'Property') continue;
          if (propKeyName(prop) === 'prNumber' && !hasIntegrationId && !hasSpread) {
            context.report({ node: prop, messageId: 'unscopedPrNumber' });
          }
          // Recurse into nested filter objects (e.g. integrationId_prNumber, NOT: {...})
          checkWhereSubtree(prop.value);
        }
        return;
      }

      // OR / AND / NOT array forms: [{ prNumber }, ...]
      if (node.type === 'ArrayExpression') {
        for (const element of node.elements) {
          checkWhereSubtree(element);
        }
      }
    }

    return {
      /**
       * Match `<anything>.gitHubPullRequest.<method>(arg)` calls by the tail
       * property name only — covers `prisma.`, `tx.`, and casted clients alike.
       * Method names are NOT enumerated: presence of a `where` property in the
       * first argument selects all query-style methods and naturally skips
       * `create` (which has no `where`).
       */
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'MemberExpression') return;
        const delegate = callee.object.property;
        if (delegate.type !== 'Identifier' || delegate.name !== 'gitHubPullRequest') return;

        const firstArg = node.arguments[0];
        if (!firstArg || firstArg.type !== 'ObjectExpression') return;

        const whereProp = firstArg.properties.find(
          (p) => p.type === 'Property' && propKeyName(p) === 'where',
        );
        if (!whereProp) return;
        // Non-literal where (variable reference etc.) is statically opaque — fail-open.
        if (whereProp.value.type !== 'ObjectExpression') return;

        checkWhereSubtree(whereProp.value);
      },
    };
  },
};

export default rule;
