/**
 * no-task-link-without-header
 *
 * The task-detail page hides the global header unless `showHeader=true` is in
 * the query (`components/header/header.tsx`). A navigation that omits it drops
 * the header and takes the way back with it.
 *
 * This has now been fixed twice by hand — once for notification links, once
 * for the note split view (#1092), where one of the two routes to the same
 * destination carried the flag and the other did not. The rule exists so the
 * third time is caught while it is being written.
 *
 * A link is fine when it spells `showHeader` itself, or when it is handed to
 * `withHeaderVisible()` (`components/header/task-detail-link.ts`).
 *
 * ONLY navigation sinks are inspected — `router.push`/`replace`, a JSX `href`,
 * an assignment to `location.href`, and object properties named `link`/`href`.
 * That is deliberate: `/tasks/${id}` is also the shape of the REST path, and
 * `fetch`, `apiFetch`, `clearApiCache` and friends use it constantly. Judging
 * by the string alone would flag every one of them.
 *
 * NOT covered (fail-open by design — a guardrail, not a proof):
 * - a helper that RETURNS a link for someone else to navigate with; put the
 *   `withHeaderVisible()` call inside the helper instead
 * - a link assembled across variables rather than in one literal
 * - `window.open`, and anything reached through a variable sink
 */

/** Navigation to `/tasks/<id>`: a dynamic id, with nothing path-like after it. */
const DETAIL_PATH_RE = /^\/tasks\/(?!new(?:[/?#]|$))[^/?#]+(?:[?#].*)?$/;

/** Where a link is being used to navigate, by the property it is passed to. */
const LINK_PROPERTY_NAMES = new Set(['link', 'href']);

/** Router methods that perform a navigation. */
const ROUTER_METHODS = new Set(['push', 'replace']);

/**
 * Whether a template literal spells a link into the task-detail page.
 *
 * The first chunk has to START the string — `` `${API_BASE}/tasks/${id}` ``
 * is a REST path, not a route — and nothing path-like may follow the id, so
 * `/tasks/${id}/comments` is left alone too.
 *
 * @param {import('estree').TemplateLiteral} node - the literal / 対象リテラル
 * @returns {boolean} whether it is a task-detail route / タスク詳細ルートなら true
 */
function templateIsDetailRoute(node) {
  const first = node.quasis[0]?.value?.cooked ?? '';
  if (node.expressions.length === 0) return false;
  // Exactly `/tasks/` means the id IS the expression. `/tasks/detail?id=`
  // is the same page under its Tauri spelling. Anything else named in the
  // first chunk is a different route — `/tasks/new?themeId=${x}` is not a
  // detail page — and a leading expression means a REST base, not a route.
  const isDetailPrefix = first === '/tasks/' || first.startsWith('/tasks/detail');
  if (!isDetailPrefix) return false;
  const afterId = node.quasis[1]?.value?.cooked ?? '';
  return afterId === '' || afterId.startsWith('?') || afterId.startsWith('#');
}

/**
 * Whether a node is a link into the task-detail page that says nothing about
 * the header.
 *
 * @param {import('estree').Node} node - the argument or attribute value / 判定対象
 * @returns {boolean} whether it needs the flag and lacks it / 不足していれば true
 */
function isBareDetailLink(node) {
  if (!node) return false;
  if (node.type === 'TemplateLiteral') {
    if (!templateIsDetailRoute(node)) return false;
    return !node.quasis.some((q) => (q.value.cooked ?? '').includes('showHeader'));
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    if (!DETAIL_PATH_RE.test(node.value)) return false;
    return !node.value.includes('showHeader');
  }
  return false;
}

/** Whether a node is a `withHeaderVisible(...)` call. */
function isWrapped(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'withHeaderVisible'
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require showHeader=true (or withHeaderVisible()) on in-app navigations to the task-detail page, which hides the global header without it',
      recommended: true,
    },
    messages: {
      missingShowHeader:
        'タスク詳細ページへのリンクに showHeader がありません。このページは showHeader=true が無いとグローバルヘッダーを隠すため、戻る手段ごと消えます。withHeaderVisible() を通すか、?showHeader=true を付けてください（components/header/task-detail-link.ts）。',
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
    /** Report `node` unless it is already wrapped or already says showHeader. */
    const check = (node) => {
      if (isWrapped(node)) return;
      if (isBareDetailLink(node)) context.report({ node, messageId: 'missingShowHeader' });
    };

    return {
      // router.push(...) / router.replace(...)
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          ROUTER_METHODS.has(callee.property.name) &&
          callee.object.type === 'Identifier' &&
          /router/i.test(callee.object.name)
        ) {
          check(node.arguments[0]);
        }
      },

      // href={...} and href="..." in JSX
      JSXAttribute(node) {
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'href') return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'JSXExpressionContainer') check(value.expression);
        else check(value);
      },

      // { link: ... } / { href: ... } — how a link reaches a Tauri command
      Property(node) {
        if (node.computed) return;
        const key =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? String(node.key.value)
              : null;
        if (key && LINK_PROPERTY_NAMES.has(key)) check(node.value);
      },

      // location.href = ... / window.location.href = ...
      AssignmentExpression(node) {
        const target = node.left;
        if (
          target.type === 'MemberExpression' &&
          !target.computed &&
          target.property.type === 'Identifier' &&
          target.property.name === 'href'
        ) {
          check(node.right);
        }
      },
    };
  },
};

export default rule;
