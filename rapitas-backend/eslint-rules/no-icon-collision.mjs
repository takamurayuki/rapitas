/**
 * no-icon-collision
 *
 * Detects ICON_POLICY violations in lucide-react imports:
 *   1. `iconCollision` — a known-collision glyph is imported (two meanings, should be unified)
 *   2. `iconMisuse`    — an owned glyph is imported outside its allowed path(s)
 *
 * Only `lucide-react` imports are scanned; other packages with same-named exports are ignored.
 * `import type` declarations and type-only specifiers are excluded (no runtime icon rendering).
 *
 * @see .claude/ICON_POLICY.md — 1グリフ=1意味ポリシー
 * @see eslint-rules/icon-policy-map.mjs — ポリシーデータ（グリフ所有マップ / 既知衝突リスト）
 */

import { KNOWN_COLLISIONS, OWNED_ICONS } from './icon-policy-map.mjs';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on lucide-react icon imports that violate ICON_POLICY (collision or path misuse)',
      recommended: false,
    },
    messages: {
      iconCollision:
        '`{{glyph}}` は複数の異なる意味で使われている既知衝突グリフです。' +
        ' いずれかのサイトを別のグリフに差し替えてください（ICON_POLICY.md §Known collisions 参照）。',
      iconMisuse:
        '`{{glyph}}` はこのパスでの使用が ICON_POLICY で許可されていません。' +
        ' 許可パス: {{allowedPaths}}。別のグリフを使うか、ICON_POLICY.md §3 を更新してください。',
    },
    schema: [
      {
        // テスト時に任意のポリシーマップを注入できるようにするためのオプション。
        // 本番設定では指定不要（バンドルマップを使用）。
        type: 'object',
        properties: {
          policy: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                glyph: { type: 'string' },
                allowedPathPatterns: { type: 'array', items: { type: 'string' } },
              },
              required: ['glyph', 'allowedPathPatterns'],
            },
          },
          collisions: {
            type: 'array',
            items: { type: 'string' },
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
    const options = context.options[0] ?? {};
    const policy = options.policy ?? OWNED_ICONS;
    const collisions = options.collisions ?? KNOWN_COLLISIONS;

    // NOTE: Windows のバックスラッシュを正規化して部分一致を安定させる。
    const filename = context.filename.replace(/\\/g, '/');

    return {
      /**
       * `ImportDeclaration` を走査し、`lucide-react` からの import のみを対象とする。
       * - `import type { ... }` 宣言全体は対象外（描画されない）
       * - `import { type Gauge }` のような型のみ specifier も対象外
       */
      ImportDeclaration(node) {
        if (node.source.value !== 'lucide-react') return;
        // 宣言全体が `import type { ... }` の場合はスキップ
        if (node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          // 個々の specifier が `{ type Gauge }` の場合はスキップ
          if (specifier.importKind === 'type') continue;

          const glyph = specifier.imported.name;

          // 1. 既知衝突チェック
          if (collisions.includes(glyph)) {
            context.report({
              node: specifier,
              messageId: 'iconCollision',
              data: { glyph },
            });
            continue;
          }

          // 2. 所有グリフのパス外使用チェック
          const owned = policy.find((entry) => entry.glyph === glyph);
          if (!owned) continue; // マップ外のグリフは対象外

          const isAllowed = owned.allowedPathPatterns.some((pattern) =>
            filename.includes(pattern),
          );
          if (!isAllowed) {
            context.report({
              node: specifier,
              messageId: 'iconMisuse',
              data: {
                glyph,
                allowedPaths: owned.allowedPathPatterns.join(', '),
              },
            });
          }
        }
      },
    };
  },
};

export default rule;
