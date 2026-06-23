/**
 * boundary-values.ts
 *
 * resolver テスト共用の境界値定数ライブラリ。
 * BoundaryCase<T> 型と各定数・ユーティリティを提供し、`it.each` / `test.each` パターンで
 * 標準境界値テストを簡潔に記述できる。
 * 副作用・import サイドエフェクトを一切含まない純定数ファイル。
 * mock.module を呼ばないため、どの resolver テストからも安全に import できる。
 *
 * 追加していない値の理由:
 *   - null / undefined: resolver の引数は string/number 型のため型不一致（型ガードで除外済み）
 *   - 'a'.repeat(1000): 対象 resolver に入力長バリデーションが存在せず検証外。
 *     バリデーション追加時は STRING_EDGES に長大文字列ケースを追加すること。
 */

/**
 * 境界値テストケースを表す型。
 *
 * @typeParam T - テスト対象の値型
 * @param label - テスト名 (`%s` / `$label`) に表示される人間可読な識別子 / test.each のラベル
 * @param value - 境界値本体（resolver に渡す実値）/ 境界値の具体的な値
 * @param note  - 暗黙前提や制約などの補足（省略可）
 */
export type BoundaryCase<T> = {
  readonly label: string;
  readonly value: T;
  readonly note?: string;
};

/**
 * 文字列引数 resolver 向けの境界値定数。
 *
 * 空文字列・空白系を網羅し、「クラッシュせず null を返す」ことを
 * resolver テストで共通検証するための標準セット（複数空白含む）。
 *
 * NOTE: 期待結果は常に「DB mock が null を返す」前提に依存する。
 * これは「DB にマッチするレコードが存在しない」暗黙前提であり、
 * 各テストの note フィールドに明示している。
 */
export const STRING_EDGES: readonly BoundaryCase<string>[] = [
  { label: '空文字列', value: '', note: 'DBレコードが存在しない前提でmockがnullを返す' },
  { label: '半角スペース', value: ' ', note: 'DBレコードが存在しない前提でmockがnullを返す' },
  { label: 'タブ文字', value: '\t', note: 'DBレコードが存在しない前提でmockがnullを返す' },
  { label: '複数空白', value: '  ', note: 'DBレコードが存在しない前提でmockがnullを返す' },
];

/**
 * 数値 ID 引数 resolver 向けの境界値定数（0/-1/1 の小規模セット）。
 *
 * 0（ゼロ境界）・-1（負数）・1（最小正常値の対照群）を含む。
 * 各 resolver は値を `where.id` / `where.configId` に素通しし、
 * クラッシュせず null を返すことを検証するための標準セット。
 *
 * NOTE: PostgreSQL INTEGER は 32bit (上限 2147483647) のため、
 * Number.MAX_SAFE_INTEGER は除外している。大きい ID 境界が必要な場合は
 * NUMERIC_ID_BOUNDARIES を使用すること。
 */
export const ID_EDGES: readonly BoundaryCase<number>[] = [
  { label: 'id=0（ゼロ境界）', value: 0 },
  { label: 'id=-1（負数）', value: -1 },
  { label: 'id=1（最小正常値）', value: 1 },
];

/**
 * 数値型 ID の境界値セット（ID_EDGES の拡張版 — MAX_SAFE_INTEGER を含む）。
 *
 * 対象: resolver の id 引数（taskId / configId / sessionId 等）
 * 期待される挙動: いずれの値でも resolver が例外を投げず null を返すこと（堅牢性確認）
 *
 * @example
 * ```ts
 * test.each(NUMERIC_ID_BOUNDARIES)('境界 id $label → null を返すこと', async ({ value }) => {
 *   const result = await resolveTaskWithTheme(value);
 *   expect(result).toBeNull();
 * });
 * ```
 */
export const NUMERIC_ID_BOUNDARIES: readonly BoundaryCase<number>[] = [
  { label: 'ゼロ', value: 0 },
  { label: '負数', value: -1 },
  { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
] as const;

/**
 * 文字列型フィールドの境界値セット（改行を含む）。
 *
 * 対象: email / token / username 等の文字列引数
 * 期待される挙動: いずれの値でも resolver が例外を投げず null を返すこと（現挙動の回帰固定）
 *
 * NOTE: debug-log-parsers.test.ts の edgeCases=['',' ','\n','\t'] を定数化・共有化したもの。
 *
 * @example
 * ```ts
 * test.each(BOUNDARY_STRINGS)('空文字列境界 $label → null を返すこと', async ({ value }) => {
 *   const result = await resolveUserByEmail(value);
 *   expect(result).toBeNull();
 * });
 * ```
 */
export const BOUNDARY_STRINGS: readonly BoundaryCase<string>[] = [
  { label: '空文字', value: '' },
  { label: '空白のみ', value: ' ' },
  { label: 'タブ', value: '\t' },
  { label: '改行', value: '\n' },
] as const;

/**
 * 時刻（epoch ミリ秒）の境界値セット。
 *
 * 対象: 将来的に時刻引数を取る resolver 関数（現状の resolver には時刻引数なし）
 * 定義のみ用意し、消費は将来のテスト追加時に行う。
 * 境界値漏れ防止の品質基準として残す。
 */
export const TIME_BOUNDARIES: readonly BoundaryCase<number>[] = [
  { label: 'epoch', value: 0 },
  { label: '負のepoch', value: -1 },
] as const;

/**
 * nullable 数値 ID 引数 resolver 向けの境界値定数。
 *
 * ID_EDGES に null を追加した拡張版。
 * `number | null` 型の外部キー引数（linkedTaskId 等）のテストに使用する。
 *
 * @example
 * ```ts
 * test.each(NULLABLE_ID_EDGES.map(bc => bc.value) as (number | null)[])(
 *   '...%p...', async (edge) => { ... }
 * );
 * ```
 */
export const NULLABLE_ID_EDGES: readonly BoundaryCase<number | null>[] = [
  ...ID_EDGES,
  { label: 'null', value: null },
];

/**
 * DB に存在しないことを表すセンチネル ID。
 *
 * mock が null を返す前提の「存在しないID」として使用する。
 * テストフィクスチャとして汎用的に使う `999` のような値ではなく、
 * 「このIDはDBに存在しない」という意図を明示するための共有定数。
 *
 * @example
 * ```ts
 * mockTask.findUnique.mockResolvedValue(null);
 * const result = await executeCopilotAction({ action: 'analyze', taskId: NONEXISTENT_ID });
 * expect(result.success).toBe(false);
 * ```
 */
export const NONEXISTENT_ID = 999;

/**
 * バリデーションで拒否されるべき非正 ID の境界値セット。
 *
 * 0（ゼロ境界）と -1（負数）を含む。`ID_EDGES` は正常値 `1` も含むため、
 * 「バリデーション拒否系」テストには本定数を使用する。
 * 拒否対象（≤0）を明示的に宣言する目的で `ID_EDGES.filter(...)` の派生ではなく独立した定数とする。
 *
 * @example
 * ```ts
 * test.each(INVALID_ID_EDGES)('ID $label は ValidationError(400)', async ({ value }) => {
 *   await expect(resolvePrOrThrow(String(value))).rejects.toThrow(ValidationError);
 * });
 * ```
 */
export const INVALID_ID_EDGES: readonly BoundaryCase<number>[] = [
  { label: 'id=0（ゼロ境界）', value: 0 },
  { label: 'id=-1（負数）', value: -1 },
] as const;

/**
 * BoundaryCase<T> 配列を `it.each` 用 `[label, value]` タプル配列に変換する。
 *
 * bun:test の `%s` 置換は primitive 前提のため、オブジェクト配列を直接渡すと
 * `[object Object]` と表示される。本関数でタプル化することで
 * `it.each(toNameTuples(EDGES))('...(%s)...', (_label, value) => ...)` の形式で
 * `%s` に `label` 文字列が正しく表示される。
 *
 * @param cases - 変換元の BoundaryCase<T> 配列
 * @returns `[label, value]` のタプル配列
 */
export function toNameTuples<T>(cases: readonly BoundaryCase<T>[]): [string, T][] {
  return cases.map((c) => [c.label, c.value]);
}
