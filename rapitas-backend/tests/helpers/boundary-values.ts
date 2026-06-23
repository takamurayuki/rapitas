/**
 * boundary-values.ts
 *
 * 共有境界値定数（SSOT）。
 * リゾルバーテストで繰り返し登場するマジックナンバー／マジック文字列を一箇所で定義し、
 * 変更が全テストに波及する状態を保つ。プロダクションコードへの依存はない。
 */

/**
 * 数値 ID の境界値センチネル。
 *
 * @returns findUnique / findFirst が null を返す各シナリオで共通利用する定数群。
 */
export const ID_EDGES = {
  /** DB に存在しない ID。「タスク/セッションが存在しない場合 → null」系テスト共通のセンチネル。 */
  NONEXISTENT: 999,
  /** 数値 ID の下限 0。 */
  ZERO: 0,
  /** 負の ID。下限バリデーションの確認用。 */
  NEGATIVE: -1,
  /** JavaScript の最大安全整数。上限バウンダリ確認用。 */
  MAX_SAFE: Number.MAX_SAFE_INTEGER,
} as const;

/**
 * 文字列入力の境界値。
 *
 * @returns メール・トークン等の文字列引数を受け取るリゾルバーの異常系テスト用定数群。
 */
export const STRING_EDGES = {
  /** 空文字列。 */
  EMPTY: '',
  // NOTE: DBレコードが存在しない前提に依存。このメール/トークンを持つ行がなければ null を返す。
  /** 空白のみ文字列。 */
  WHITESPACE_ONLY: ' ',
  /** 極端に長い文字列（1000文字）。長大入力でのクラッシュを検証する。 */
  VERY_LONG: 'x'.repeat(1000),
} as const;

/**
 * null / undefined を含む nullable 引数の境界値。
 *
 * @returns titleMatchesTask・resolvePrWorkingDirectory 等の nullable 引数テスト用定数群。
 */
export const NULLABLE_ID_EDGES = {
  /** null 値。 */
  NULL_VALUE: null,
  /** undefined 値。 */
  UNDEFINED_VALUE: undefined,
} as const;
