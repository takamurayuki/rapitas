/**
 * boundary-values.ts
 *
 * resolver テスト共用の境界値定数ライブラリ。
 * BoundaryCase<T> 型と STRING_EDGES / ID_EDGES 定数を提供し、
 * `it.each(toNameTuples(EDGES))` パターンで標準境界値テストを簡潔に記述できる。
 *
 * 追加していない値の理由:
 *   - null / undefined: resolver の引数は string 型のため型不一致（型ガードで除外済み）
 *   - 'a'.repeat(1000): 対象 resolver に入力長バリデーションが存在せず検証外。
 *     バリデーション追加時は STRING_EDGES に長大文字列ケースを追加すること。
 *   - Number.MAX_SAFE_INTEGER: PostgreSQL INTEGER は 32bit（上限 2147483647）であり、
 *     MAX_SAFE_INTEGER(2^53) は DB で overflow するため境界値として不適切。
 */

/**
 * 境界値テストケースを表す型。
 *
 * @param label - `it.each` のテスト名 (`%s`) に表示される人間可読な識別子
 * @param input - 境界値本体（resolver に渡す実値）
 * @param note  - 暗黙前提や制約などの補足（省略可）
 */
export interface BoundaryCase<T> {
  label: string;
  input: T;
  note?: string;
}

/**
 * 文字列引数 resolver 向けの境界値定数。
 *
 * 空文字列・空白系を網羅し、「クラッシュせず null を返す」ことを
 * resolver テストで共通検証するための標準セット。
 *
 * NOTE: 期待結果は常に「DB mock が null を返す」前提に依存する。
 * これは「DB にマッチするレコードが存在しない」暗黙前提であり、
 * 各テストの note フィールドに明示している。
 */
export const STRING_EDGES: BoundaryCase<string>[] = [
  {
    label: '空文字列',
    input: '',
    note: 'DBレコードが存在しない前提でmockがnullを返す',
  },
  {
    label: '半角スペース',
    input: ' ',
    note: 'DBレコードが存在しない前提でmockがnullを返す',
  },
  {
    label: 'タブ文字',
    input: '\t',
    note: 'DBレコードが存在しない前提でmockがnullを返す',
  },
  {
    label: '複数空白',
    input: '  ',
    note: 'DBレコードが存在しない前提でmockがnullを返す',
  },
];

/**
 * 数値 ID 引数 resolver 向けの境界値定数。
 *
 * 0（ゼロ境界）・-1（負数）・1（最小正常値の対照群）を含む。
 * 各 resolver は値を `where.id` / `where.configId` に素通しし、
 * クラッシュせず null を返すことを検証するための標準セット。
 *
 * NOTE: PostgreSQL INTEGER は 32bit (上限 2147483647) のため、
 * Number.MAX_SAFE_INTEGER は除外している。大きい ID 境界が必要な場合は
 * 2147483647 を個別に追加すること。
 */
export const ID_EDGES: BoundaryCase<number>[] = [
  {
    label: 'id=0（ゼロ境界）',
    input: 0,
  },
  {
    label: 'id=-1（負数）',
    input: -1,
  },
  {
    label: 'id=1（最小正常値）',
    input: 1,
  },
];

/**
 * BoundaryCase<T> 配列を `it.each` 用 `[label, input]` タプル配列に変換する。
 *
 * bun:test の `%s` 置換は primitive 前提のため、オブジェクト配列を直接渡すと
 * `[object Object]` と表示される。本関数でタプル化することで
 * `it.each(toNameTuples(EDGES))('email "%s" → null', (label, input) => ...)` の形式で
 * `%s` に `label` 文字列が正しく表示される。
 *
 * @param cases - 変換元の BoundaryCase<T> 配列
 * @returns `[label, input]` のタプル配列
 */
export function toNameTuples<T>(cases: BoundaryCase<T>[]): [string, T][] {
  return cases.map((c) => [c.label, c.input]);
}
