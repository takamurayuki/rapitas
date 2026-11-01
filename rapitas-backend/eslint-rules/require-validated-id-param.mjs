/**
 * require-validated-id-param
 *
 * Detects a path parameter being turned into a number without being validated
 * first — `parseInt(params.id)`, `Number(params.id)`, `+params.id` — inside a
 * mutating route handler.
 *
 * Why this is a lint error rather than a convention: `parseInt` stops at the
 * first character it cannot read and returns what it had, so a path segment
 * naming one row resolves to another. Reproduced on the running server before
 * #1349's first fix:
 *
 *   DELETE /tasks/1473abc          -> 200 {"id":1473,"trashId":986}, row gone
 *   POST   /tasks/1475abc/stop-execution
 *                                  -> 200, row 1475's status forced to 'todo'
 *                                     and its executionGenerationId bumped 0->1
 *
 * The suffix is discarded in silence, so nothing downstream can tell the id
 * apart from one the caller actually typed. `isValidEntityId` (utils/common/
 * id-validation.ts) and `parseId` (middleware/error-handler.ts) reject it.
 *
 * Detection is on the AST, not the text, because the dangerous shapes do not
 * all contain the string `parseInt(params.`:
 *
 *   const raw = params.id;      parseInt(raw)          // via a local
 *   const { id } = params;      parseInt(id)           // via destructuring
 *   const { id: rawId } = ctx.params;  Number(rawId)   // ...and a rename
 *
 * NOT covered (fail-open by design — a guardrail, not a proof):
 * - a handler extracted into another module, where no `.post`/`.patch`/
 *   `.delete`/`.put` call is an ancestor of the coercion. `methods` defaults to
 *   the mutating verbs, and a coercion whose verb cannot be determined is left
 *   alone, so this reports what it can prove rather than guessing.
 * - `GET`, until the remaining read routes are migrated (#1349 is staged by
 *   HTTP verb, mutations first). Add 'get' to the `methods` option to widen it;
 *   ~50 read sites still coerce. Doing so needs a fresh ratchet list, because
 *   the rule is an error everywhere now: all 106 mutating sites are migrated,
 *   so id-param-migration-baseline and its test were deleted rather than left
 *   empty (an exemption list with nothing in it cannot fail).
 * - a parameter reached through indexing (`params['id']`) or spread.
 */

/** Numeric coercions that silently truncate. `parseId` is the validated one. */
const COERCERS = new Set(['parseInt', 'parseFloat', 'Number']);

/** Calls that reject a non-numeric id instead of truncating it. */
const VALIDATORS = new Set(['isValidEntityId', 'parseId']);

/** Verbs whose handlers write. Overridable via the `methods` option. */
const DEFAULT_METHODS = ['post', 'patch', 'delete', 'put'];

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

/**
 * Whether a node denotes the route's params object (`params`, `ctx.params`).
 *
 * @param {import('estree').Node} node - candidate node / 判定対象
 * @returns {boolean} true when it is the params object / params オブジェクトなら true
 */
function isParamsObject(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'params';
  if (node.type === 'MemberExpression' && !node.computed) {
    return staticName(node.property) === 'params';
  }
  return false;
}

/**
 * Finds a variable by name, walking outwards through the scope chain.
 *
 * @param {import('eslint').Scope.Scope | null} scope - starting scope / 開始スコープ
 * @param {string} name - variable name / 変数名
 * @returns {import('eslint').Scope.Variable | null} the variable / 見つかった変数
 */
function findVariable(scope, name) {
  let current = scope;
  while (current) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found) return found;
    current = current.upper;
  }
  return null;
}

/**
 * Resolves which path parameter a node ultimately reads, as a canonical
 * `params.<name>` string, following locals and destructuring.
 *
 * @param {import('estree').Node} node - expression to resolve / 解決対象の式
 * @param {import('eslint').Scope.Scope} scope - scope of that node / そのノードのスコープ
 * @param {number} depth - recursion guard / 再帰の深さ
 * @returns {string | null} canonical origin, or null when not a path param / パスパラメータでなければ null
 */
function paramsOrigin(node, scope, depth = 0) {
  if (!node || depth > 6) return null;

  if (node.type === 'MemberExpression' && !node.computed) {
    const property = staticName(node.property);
    if (!property) return null;
    return isParamsObject(node.object) ? `params.${property}` : null;
  }

  if (node.type !== 'Identifier') return null;

  const variable = findVariable(scope, node.name);
  if (!variable) return null;

  for (const def of variable.defs) {
    if (def.type !== 'Variable' || !def.node.init) continue;
    const { id, init } = def.node;

    // const raw = params.id;
    if (id.type === 'Identifier') return paramsOrigin(init, scope, depth + 1);

    // const { id } = params;  /  const { id: rawId } = ctx.params;
    if (id.type === 'ObjectPattern' && isParamsObject(init)) {
      for (const property of id.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        if (property.value.type !== 'Identifier') continue;
        if (property.value.name !== node.name) continue;
        const key = staticName(property.key);
        if (key) return `params.${key}`;
      }
    }
  }

  return null;
}

/**
 * Walks the ancestor chain to the HTTP verb whose handler contains `node`.
 *
 * @param {import('estree').Node[]} ancestors - ancestors, outermost first / 祖先ノード列
 * @param {Set<string>} methods - verbs under the rule / 対象の HTTP メソッド
 * @returns {{ matched: boolean, method: string | null }} verb match / 判定結果
 */
function enclosingRouteMethod(ancestors, methods) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor.type !== 'CallExpression') continue;
    const callee = ancestor.callee;
    if (callee.type !== 'MemberExpression' || callee.computed) continue;
    const name = staticName(callee.property);
    if (!name) continue;
    const lowered = name.toLowerCase();
    if (methods.has(lowered)) return { matched: true, method: lowered };
    // Elysia registers every verb through a same-shaped call, so the first
    // verb-looking ancestor decides; a `.get` handler must not be reported
    // just because some `.post` sits further out in the chain.
    if (lowered === 'get' || lowered === 'head' || lowered === 'options') {
      return { matched: false, method: lowered };
    }
  }
  return { matched: false, method: null };
}

/**
 * Returns the innermost function containing `node`.
 *
 * @param {import('estree').Node[]} ancestors - ancestors, outermost first / 祖先ノード列
 * @returns {import('estree').Node | null} the function node / 直近の関数ノード
 */
function enclosingFunction(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const { type } = ancestors[index];
    if (
      type === 'FunctionDeclaration' ||
      type === 'FunctionExpression' ||
      type === 'ArrowFunctionExpression'
    ) {
      return ancestors[index];
    }
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a path parameter to be validated with isValidEntityId / parseId before it is coerced to a number in a mutating route handler — parseInt truncates, so /tasks/5abc reaches row 5',
      recommended: true,
    },
    messages: {
      unvalidatedIdParam:
        '`{{origin}}` をガードせずに {{coercer}} へ渡しています。{{coercer}} は読めない文字で止まるため、`/tasks/5abc` が行5に届きます（#1349 で実機再現: DELETE /tasks/1473abc が行1473を削除し、POST /tasks/1475abc/stop-execution が行1475のステータスを todo に戻しました）。`if (!isValidEntityId({{origin}})) throw new ValidationError(...)` でガードしてから Number() を使うか、`parseId({{origin}})` を使ってください。',
    },
    schema: [
      {
        type: 'object',
        properties: {
          methods: { type: 'array', items: { type: 'string' }, minItems: 1 },
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
    const methods = new Set(
      (context.options?.[0]?.methods ?? DEFAULT_METHODS).map((method) => method.toLowerCase()),
    );
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** @type {{ node: import('estree').Node, origin: string, coercer: string, fnRange: [number, number] | null }[]} */
    const coercions = [];
    /** @type {{ origin: string, start: number, fnRange: [number, number] | null }[]} */
    const guards = [];

    /**
     * Records a coercion of a path parameter, or a guard call, for the
     * end-of-file match. Collected rather than reported inline because a guard
     * may be written either before or after the coercion in source order.
     *
     * @param {import('estree').Node} node - the coercion/guard node / 対象ノード
     * @param {import('estree').Node} argument - the value being read / 読まれる値
     * @param {string} name - callee name, or the unary operator / 呼び出し名
     */
    function record(node, argument, name) {
      const origin = paramsOrigin(argument, sourceCode.getScope(argument));
      if (!origin) return;

      const ancestors = sourceCode.getAncestors(node);
      const fn = enclosingFunction(ancestors);
      const fnRange = fn ? fn.range : null;

      if (VALIDATORS.has(name)) {
        guards.push({ origin, start: node.range[0], fnRange });
        return;
      }

      if (!enclosingRouteMethod(ancestors, methods).matched) return;
      coercions.push({ node, origin, coercer: name, fnRange });
    }

    return {
      /**
       * Collects parseInt/Number/parseFloat calls and validator calls.
       *
       * @param {import('estree').CallExpression} node - the call / 呼び出しノード
       */
      CallExpression(node) {
        const name =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.type === 'MemberExpression' && !node.callee.computed
              ? staticName(node.callee.property)
              : null;
        if (!name) return;
        if (!COERCERS.has(name) && !VALIDATORS.has(name)) return;
        if (node.arguments.length === 0) return;
        record(node, node.arguments[0], name);
      },

      /**
       * Collects the unary `+params.id` form.
       *
       * @param {import('estree').UnaryExpression} node - the unary expression / 単項式
       */
      UnaryExpression(node) {
        if (node.operator !== '+') return;
        record(node, node.argument, 'Number');
      },

      /** Reports every coercion with no guard on the same parameter. */
      'Program:exit'() {
        for (const coercion of coercions) {
          const guarded = guards.some((guard) => {
            if (guard.origin !== coercion.origin) return false;
            // The guard has to be in the same function and run first, or it is
            // some other route's check of a same-named parameter.
            if (!guard.fnRange || !coercion.fnRange) return false;
            if (guard.fnRange[0] !== coercion.fnRange[0]) return false;
            return guard.start < coercion.node.range[0];
          });
          if (guarded) continue;
          context.report({
            node: coercion.node,
            messageId: 'unvalidatedIdParam',
            data: { origin: coercion.origin, coercer: coercion.coercer },
          });
        }
      },
    };
  },
};

export default rule;
