/**
 * require-validated-id-param.test.mjs
 *
 * Unit tests for the require-validated-id-param ESLint rule.
 *
 * Strategy follows no-unguarded-task-delete.test.mjs: `Linter.verify()` inside
 * each `it()`, because `RuleTester.run()` calls `describe()` which bun:test
 * forbids inside an `it()` callback.
 *
 * The cases are split deliberately: the first block is the shapes a text search
 * for `parseInt(params.` would miss, which is the reason this rule is on the
 * AST. The last block is the false positives that would make the rule
 * unusable — a rule that reddens correct code gets switched off.
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import tsparser from '@typescript-eslint/parser';
import rule from './require-validated-id-param.mjs';

/**
 * Runs the rule against `code` and returns the array of lint messages.
 *
 * @param {string} code - source to lint / 対象ソース
 * @param {object} [options] - rule options / ルールオプション
 * @returns {import('eslint').Linter.LintMessage[]} messages / 検出結果
 */
function runRule(code, options) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { local: { rules: { 'require-validated-id-param': rule } } },
    rules: {
      'local/require-validated-id-param': options ? ['error', options] : 'error',
    },
    // NOTE(#1349 review): the TypeScript parser, not espree. The rule guards
    // TypeScript files, and the three sites that slipped past its first version
    // were all TS-only syntax (`context.params as { id: string }`) which espree
    // cannot parse at all — so testing on espree could not have caught them.
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  });
}

/**
 * Wraps a handler body in an Elysia-shaped route registration.
 *
 * @param {string} body - handler body / ハンドラ本体
 * @param {string} [method] - HTTP verb / HTTP メソッド
 * @returns {string} the source / 生成したソース
 */
function route(body, method = 'delete') {
  return `app.${method}('/tasks/:id', async (context) => { const { params } = context; ${body} });`;
}

describe('require-validated-id-param — reports an unguarded coercion', () => {
  it.each([
    ['parseInt directly', route('const taskId = parseInt(params.id); await stop(taskId);')],
    ['Number directly', route('const taskId = Number(params.id); await stop(taskId);')],
    ['parseFloat directly', route('await stop(parseFloat(params.id));')],
    ['the unary plus form', route('await stop(+params.id);')],
    // The three shapes a text search for `parseInt(params.` does not find.
    ['through a local', route('const raw = params.id; await stop(parseInt(raw));')],
    ['through destructuring', route('const { id } = params; await stop(parseInt(id));')],
    [
      'through a renamed destructuring',
      route('const { id: rawId } = params; await stop(Number(rawId));'),
    ],
    ['on context.params', `app.patch('/x/:id', (ctx) => update(parseInt(ctx.params.id)));`],
    // A GET that truncates reads someone else's row (#1349's read pass).
    ['in a GET handler', `app.get('/tasks/:id', (ctx) => read(parseInt(ctx.params.id)));`],
  ])('%s', (_label, code) => {
    const msgs = runRule(code);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unvalidatedIdParam');
  });

  it.each([['get'], ['post'], ['patch'], ['delete'], ['put']])(
    'covers %s by default',
    (method) => {
      expect(runRule(route('await stop(parseInt(params.id));', method))).toHaveLength(1);
    },
  );

  // Each of these hid a real site from the first version of this rule
  // (#1349 review), and each is TypeScript-only syntax.
  it.each([
    [
      'a destructure through a type assertion',
      `app.post('/agents/:id/api-key', async (context) => {
         const { id } = context.params as { id: string };
         return save(parseInt(id));
       });`,
    ],
    [
      'a member read through a type assertion',
      `app.post('/themes/:id/auto-run', async (context) => {
         const themeId = parseInt((context.params as { id: string }).id);
         return run(themeId);
       });`,
    ],
    [
      'a handler extracted into its own exported function',
      `export async function handleDryRun(ctx: DryRunContext) {
         const taskId = parseInt(ctx.params.taskId);
         return dryRun(taskId);
       }`,
    ],
    [
      'a non-null assertion in the way',
      `app.patch('/x/:id', (ctx) => update(parseInt(ctx.params!.id)));`,
    ],
  ])('%s', (_label, code) => {
    const msgs = runRule(code);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unvalidatedIdParam');
  });

  it('reports a second parameter in the same handler', () => {
    const msgs = runRule(
      route('await move(parseInt(params.id), parseInt(params.parentId));', 'patch'),
    );
    expect(msgs).toHaveLength(2);
  });
});

describe('require-validated-id-param — accepts validated code', () => {
  it('accepts an isValidEntityId guard before the coercion', () => {
    const code = route(
      'if (!isValidEntityId(params.id)) throw new ValidationError("bad"); const taskId = Number(params.id); await stop(taskId);',
    );
    expect(runRule(code)).toHaveLength(0);
  });

  it('accepts a guard written against a destructured name', () => {
    const code = route(
      'const { id } = params; if (!isValidEntityId(id)) throw new ValidationError("bad"); await stop(Number(id));',
    );
    expect(runRule(code)).toHaveLength(0);
  });

  it('accepts parseId, which rejects instead of truncating', () => {
    expect(runRule(route('await stop(parseId(params.id, "タスクID"));'))).toHaveLength(0);
  });

  it('still reports when the guard runs AFTER the coercion', () => {
    // Order matters: the row has already been resolved by then.
    const code = route(
      'const taskId = Number(params.id); if (!isValidEntityId(params.id)) throw new ValidationError("bad"); await stop(taskId);',
    );
    expect(runRule(code)).toHaveLength(1);
  });

  it('still reports when the guard checks a DIFFERENT parameter', () => {
    const code = route(
      'if (!isValidEntityId(params.parentId)) throw new ValidationError("bad"); await stop(Number(params.id));',
      'patch',
    );
    expect(runRule(code)).toHaveLength(1);
  });

  it("does not let one handler's guard cover another handler", () => {
    const code = `
      app.get('/tasks/:id', (context) => {
        const { params } = context;
        if (!isValidEntityId(params.id)) throw new ValidationError('bad');
        return read(Number(params.id));
      });
      app.delete('/tasks/:id', (context) => {
        const { params } = context;
        return remove(Number(params.id));
      });
    `;
    expect(runRule(code)).toHaveLength(1);
  });
});

describe('require-validated-id-param — leaves non-route code alone', () => {
  it.each([
    // Not a path parameter at all.
    ['a request body field', route('await stop(parseInt(body.taskId));')],
    ['a query string field', route('await stop(parseInt(query.page));')],
    ['an env var', route('await stop(parseInt(process.env.PORT));')],
    ['a plain local', route('const raw = "12"; await stop(parseInt(raw));')],
    // parseInt with a radix on something that is not a param.
    ['a radix parse of a header', route('await stop(parseInt(headers["x-id"], 10));')],
  ])('%s', (_label, code) => {
    expect(runRule(code)).toHaveLength(0);
  });

  it('covers GET by default and goes quiet when methods narrows it away', () => {
    // #1349's read pass widened the default to every verb. The option remains
    // so a verb this misses can be added without editing the rule.
    const code = `app.get('/tasks/:id', (ctx) => read(parseInt(ctx.params.id)));`;
    expect(runRule(code)).toHaveLength(1);
    expect(runRule(code, { methods: ['post'] })).toHaveLength(0);
  });
});
