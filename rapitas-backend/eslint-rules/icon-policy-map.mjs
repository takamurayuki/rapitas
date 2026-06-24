/**
 * icon-policy-map
 *
 * ICON_POLICY.md §3「確立された意味」に基づくグリフ所有マップ。
 * このファイルはポリシーデータのみを持ち、検出ロジックは no-icon-collision.mjs に分離している。
 *
 * 更新方針: ICON_POLICY.md §3 を改訂した際は、このファイルの対応エントリも同時に更新すること。
 * 初期シードは保守的に最小から開始する — ノイズ回避のため高確度のエントリのみ記載。
 * 段階的に拡張していく（living reference）。
 *
 * @see .claude/ICON_POLICY.md §3 Established Meanings
 */

/**
 * グリフの所有権マップ。
 * 各エントリが「このグリフはこのパスでのみ許可される」という意味を持つ。
 * `allowedPathPatterns` に部分一致する `context.filename` であれば、使用を許可する。
 *
 * @type {Array<{ glyph: string, allowedPathPatterns: string[] }>}
 */
export const OWNED_ICONS = [
  {
    // Lightbulb = アイデア (idea box) のみの意味。/ideas/ 配下での使用のみ許可。
    // ICON_POLICY §3: 「Lightbulb — アイデア (idea box / an idea)」
    glyph: 'Lightbulb',
    allowedPathPatterns: ['/ideas'],
  },
];

/**
 * 既知衝突グリフ一覧。
 * 同一グリフが複数の異なる意味で使われており、どちらかに統一すべきもの。
 * いずれかのサイトを別グリフに差し替えるまでは `warn` で警告し続ける。
 *
 * ICON_POLICY §3 Known collisions より:
 *   Gauge — 複雑度「標準」 と 懸念の種別「パフォーマンス」 が衝突
 *
 * @type {string[]}
 */
export const KNOWN_COLLISIONS = ['Gauge'];
