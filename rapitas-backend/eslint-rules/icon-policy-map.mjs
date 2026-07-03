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
    // Lightbulb = アイデア (idea box) のみの意味。/ideas/ 配下に加え、
    // 「同一概念の正当な再利用」site を明示的に許可する:
    //   - IdeaBoxPanel: ホーム画面のアイデアボックス起動ウィジェット本体
    //   - memo-section: メモ種別「アイデア」バッジ（アイデアそのもの）
    //   - category/icons: ユーザーが自由選択するアイコンピッカー登録
    //     （キーワードに「アイデア/ひらめき」を含み同一概念）
    //   - header/header.tsx: /ideas ページへのナビゲーションリンクアイコン
    // ICON_POLICY §3: 「Lightbulb — アイデア (idea box / an idea)」
    glyph: 'Lightbulb',
    allowedPathPatterns: ['/ideas', 'IdeaBoxPanel', 'memo-section', 'category/icons', 'header/header.tsx'],
  },
];

/**
 * 既知衝突グリフ一覧。
 * 同一グリフが複数の異なる意味で使われており、どちらかに統一すべきもの。
 * いずれかのサイトを別グリフに差し替えるまでは `warn` で警告し続ける。
 *
 * NOTE: Gauge はかつて 複雑度「標準」 と 懸念の種別「パフォーマンス」 の二重使用が
 * あったが、複雑度「標準」側は ArrowRight/Diamond 等へ移行済み（現在コード上に
 * Gauge の複雑度使用は存在しない）。懸念の種別「パフォーマンス」のみが残る唯一の
 * 意味となったため、既知衝突リストから除外した。ICON_POLICY.md 側の表も合わせて更新。
 *
 * @type {string[]}
 */
export const KNOWN_COLLISIONS = [];
