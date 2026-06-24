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

// ---------------------------------------------------------------------------
// メタデータスキーマ（BOUNDARY_CONTEXT_MAP 用）
// ---------------------------------------------------------------------------

/**
 * 境界値定数が対象とする TypeScript 入力型のユニオン。
 * `edgesConstName()` の 3 分岐と一致させており、将来の参照統一に備える。
 */
export type BoundaryInputType = 'string' | 'number' | 'number | null';

/**
 * 境界値定数 1 件分のメタデータ。
 * BOUNDARY_CONTEXT_MAP のエントリ型として使用する。
 *
 * @param constName - 定数名（BOUNDARY_CONTEXT_MAP のキーと同値）/ 例: 'STRING_EDGES'
 * @param inputType - 対象の TypeScript 入力型 / 例: 'string'
 * @param includesNewline - 文字列定数の場合に改行（'\\n'）を含むか（string以外では常に false）
 * @param includesLargeValue - Number.MAX_SAFE_INTEGER 等の大値を含むか（数値定数のみ）
 * @param useFor - どのコンテキストで使うかの 1 行説明（ガイド表の本文になる）
 * @param genUsed - gen-resolver-boundary-tests が自動選択する定数か
 * @param status - 'active': 現在消費箇所あり / 'reserved': 将来用・定義のみ
 */
export interface BoundaryConstMeta {
  readonly constName: string;
  readonly inputType: BoundaryInputType;
  readonly includesNewline: boolean;
  readonly includesLargeValue: boolean;
  readonly useFor: string;
  readonly genUsed: boolean;
  readonly status: 'active' | 'reserved';
}

/**
 * テスト共通境界値定数のメタデータ SSoT。
 *
 * キー = 定数名。「入力型・改行の有無 → 推奨定数」を機械可読な形で一元管理し、
 * `scripts/gen-boundary-guide.ts` がこれを読んでガイド Markdown を生成する。
 * `STRING_EDGES`（改行なし）と `BOUNDARY_STRINGS`（改行あり）の選択は
 * `includesNewline` フィールドで判断できる。
 *
 * 新しい境界値定数を追加した場合は必ずここにエントリを追加すること。
 * エントリ漏れは `scripts/gen-boundary-guide.test.ts` の網羅性テストで検出される。
 */
export const BOUNDARY_CONTEXT_MAP: Readonly<Record<string, BoundaryConstMeta>> = {
  STRING_EDGES: {
    constName: 'STRING_EDGES',
    inputType: 'string',
    includesNewline: false,
    includesLargeValue: false,
    useFor:
      '文字列引数 resolver 向けの標準セット。空文字・空白系を網羅し改行を含まない入力フィールド（email / token 等）に使用する。',
    genUsed: true,
    status: 'active',
  },
  ID_EDGES: {
    constName: 'ID_EDGES',
    inputType: 'number',
    includesNewline: false,
    includesLargeValue: false,
    useFor:
      '数値 ID 引数 resolver 向けの標準セット（0/-1/1）。PostgreSQL INTEGER 範囲内の小規模境界値テストに使用する。',
    genUsed: true,
    status: 'active',
  },
  NUMERIC_ID_BOUNDARIES: {
    constName: 'NUMERIC_ID_BOUNDARIES',
    inputType: 'number',
    includesNewline: false,
    includesLargeValue: true,
    useFor:
      'ID_EDGES の拡張版（Number.MAX_SAFE_INTEGER を追加）。数値上限での resolver 堅牢性を検証する場合に使用する。',
    genUsed: false,
    status: 'active',
  },
  BOUNDARY_STRINGS: {
    constName: 'BOUNDARY_STRINGS',
    inputType: 'string',
    includesNewline: true,
    includesLargeValue: false,
    useFor:
      '改行（\\n）を有効入力として扱う文字列フィールド向け。email 等の改行禁止フィールドには STRING_EDGES を使用すること。',
    genUsed: false,
    status: 'active',
  },
  TIME_BOUNDARIES: {
    constName: 'TIME_BOUNDARIES',
    inputType: 'number',
    includesNewline: false,
    includesLargeValue: false,
    useFor:
      '将来的に時刻（epoch ミリ秒）引数を取る resolver 向けに予約された定数。現状の resolver には時刻引数がなく、消費箇所はない。',
    genUsed: false,
    status: 'reserved',
  },
  NULLABLE_ID_EDGES: {
    constName: 'NULLABLE_ID_EDGES',
    inputType: 'number | null',
    includesNewline: false,
    includesLargeValue: false,
    useFor:
      'number | null 型の外部キー引数（linkedTaskId 等）向け。ID_EDGES に null を追加した拡張版。gen-resolver-boundary-tests が自動選択する。',
    genUsed: true,
    status: 'active',
  },
} as const;
