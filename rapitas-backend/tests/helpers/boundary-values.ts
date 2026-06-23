/**
 * boundary-values
 *
 * 共有境界値定数・型を提供するテストユーティリティ。
 * 副作用・import サイドエフェクトを一切含まない純定数ファイル。
 * mock.module を呼ばないため、どの resolver テストからも安全に import できる。
 */

/**
 * 境界値ケースの汎用コンテナ型。
 * test.each で `'%label'` のラベル付きテスト名を自動生成するために使用する。
 *
 * @typeParam T - テスト対象の値型 / テスト対象の値の型
 */
export type BoundaryCase<T> = {
  /** テスト名に表示されるラベル / test.each のラベル */
  readonly label: string;
  /** テストに渡す境界値 / 境界値の具体的な値 */
  readonly value: T;
};

/**
 * 数値型 ID の境界値セット。
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
 * 文字列型フィールドの境界値セット。
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
