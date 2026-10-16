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
  { label: 'CRLF改行', value: '\r\n' },
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
 * 日付文字列の境界値セット（ISO 8601 形式）。
 *
 * 対象: 日付文字列引数を取る resolver 関数・バリデーション層
 * 期待される挙動: いずれの値でも resolver が例外を投げないこと（堅牢性確認）
 *
 * 設計: `BoundaryCase<Date>` ではなく `BoundaryCase<string>` を採用。
 * `Date` オブジェクト型にすると gen-boundary-guide.ts の `renderValue()` が
 * `[object Object]` を出力するため、ISO 8601 文字列で統一する。
 * テスト側で `new Date(value)` による復元が必要な場合はその場で変換すること。
 *
 * NOTE: 定義のみ・将来消費。TIME_BOUNDARIES の Date 版に相当する。
 */
export const DATE_EDGES: readonly BoundaryCase<string>[] = [
  {
    label: 'Unix epoch (ISO)',
    value: '1970-01-01T00:00:00.000Z',
    note: '定義のみ・将来消費 — new Date(value).getTime() === 0',
  },
  {
    label: 'epoch 直前 (ISO)',
    value: '1969-12-31T23:59:59.999Z',
    note: '定義のみ・将来消費 — new Date(value).getTime() === -1',
  },
  {
    label: 'JS Date 最大値 (ISO)',
    value: '+275760-09-13T00:00:00.000Z',
    note: '定義のみ・将来消費 — new Date(value).getTime() === 8640000000000000',
  },
  {
    label: '空文字（無効パース）',
    value: '',
    note: 'new Date("") → Invalid Date',
  },
] as const;

/**
 * Enum 型引数に対する無効値の境界値セット。
 *
 * 対象: string Enum フィールド（TaskStatus / WorkflowStatus 等）の無効値テスト
 * 期待される挙動: バリデーション層が拒否すること
 *
 * NOTE: `makeEnumBoundaries()` の `invalid` 引数省略時のデフォルト値として使用する。
 *
 * @example
 * ```ts
 * test.each(ENUM_INVALID_EDGES)('無効ステータス $label は拒否されること', ({ value }) => {
 *   expect(() => validateStatus(value)).toThrow();
 * });
 * ```
 */
export const ENUM_INVALID_EDGES: readonly BoundaryCase<string>[] = [
  { label: '空文字', value: '' },
  { label: '未知の文字列', value: 'invalid_status' },
  { label: '大文字化', value: 'INVALID' },
  { label: '空白のみ', value: ' ' },
] as const;

/**
 * 浮動小数点数の境界値セット（NaN / Infinity / EPSILON を含む）。
 *
 * 対象: 将来的に浮動小数点引数を取る関数（現状の resolver には引数なし）
 * 定義のみ用意し、消費は将来のテスト追加時に行う。
 * 境界値漏れ防止の品質基準として残す（TIME_BOUNDARIES と同じ扱い）。
 *
 * NOTE: `typeof NaN === 'number'` かつ `typeof Infinity === 'number'` のため
 * `BoundaryCase<number>[]` として型安全に格納できる。
 * `renderValue()` は `` `NaN` `` / `` `Infinity` `` を正しく出力する。
 *
 * NOTE: `-0` の `renderValue()` 出力は `` `0` `` と同じになる（JS の仕様）。
 * ラベル「負のゼロ (-0)」によって識別する。
 */
export const FLOAT_EDGES: readonly BoundaryCase<number>[] = [
  { label: 'ゼロ', value: 0, note: '定義のみ・将来消費' },
  { label: '負のゼロ (-0)', value: -0, note: '定義のみ・将来消費 — Object.is(-0, 0) === false' },
  { label: 'NaN', value: Number.NaN, note: '定義のみ・将来消費 — Number.isNaN(v) で確認' },
  {
    label: '正の無限大',
    value: Number.POSITIVE_INFINITY,
    note: '定義のみ・将来消費',
  },
  {
    label: '負の無限大',
    value: Number.NEGATIVE_INFINITY,
    note: '定義のみ・将来消費',
  },
  {
    label: 'EPSILON',
    value: Number.EPSILON,
    note: '定義のみ・将来消費 — 浮動小数点比較の最小有効差',
  },
] as const;

/**
 * PostgreSQL INTEGER (INT4) 型の境界値セット。
 *
 * 対象: DB スキーマで `Int`（32bit INT4）として定義されたカラムへの入力
 * 期待される挙動: オーバーフロー値でもアプリケーション層でエラーにならないこと、
 * または Prisma が例外を投げること（動作の確認が目的）
 *
 * NOTE: `NUMERIC_ID_BOUNDARIES`（MAX_SAFE_INTEGER）との差別化設計。
 * こちらは PostgreSQL INT4 の上限・オーバーフロー境界の検証が目的。
 *
 * @example
 * ```ts
 * test.each(PG_INT_BOUNDARIES)('INT4 境界 $label でエラーが起きないこと', async ({ value }) => {
 *   const result = await resolveTask(value);
 *   expect(result).toBeNull();
 * });
 * ```
 */
export const PG_INT_BOUNDARIES: readonly BoundaryCase<number>[] = [
  {
    label: 'INT4 最小値',
    value: -2147483648,
    note: 'PostgreSQL INTEGER の下限（MIN_INT4）',
  },
  {
    label: 'INT4 最大値',
    value: 2147483647,
    note: 'PostgreSQL INTEGER の上限（MAX_INT4）',
  },
  {
    label: 'INT4 オーバーフロー',
    value: 2147483648,
    note: 'MAX_INT4 + 1。Prisma が例外を投げる可能性がある',
  },
  { label: 'ゼロ', value: 0 },
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

/**
 * Enum 型の境界値ケースセット（有効値 + 無効値）を生成するファクトリ関数。
 *
 * `valid` は実 Enum 値配列から動的生成するため、Enum 定数を変更すると
 * テストケースも自動で追従する（SSOT）。
 * `invalid` は省略時に `ENUM_INVALID_EDGES` を使用する。
 *
 * NOTE: 動的関数のため `BoundaryGuideInput` 静的スキーマには収まらない。
 * `toNameTuples()` と並ぶユーティリティとして提供し、ガイドには非収録（JSDoc のみ）。
 *
 * @param validValues - Enum の全有効値配列（`as const` 推奨）/ 有効な Enum 値のリスト
 * @param invalidSamples - 無効値ケースの上書き（省略時は `ENUM_INVALID_EDGES`） / 無効値ケース配列（省略可）
 * @returns `{ valid, invalid }` — 有効値・無効値の `BoundaryCase` セット
 *
 * @example
 * ```ts
 * const WORKFLOW_STATUSES = ['todo', 'in_progress', 'done'] as const;
 * type WorkflowStatus = typeof WORKFLOW_STATUSES[number];
 *
 * const boundaries = makeEnumBoundaries<WorkflowStatus>(WORKFLOW_STATUSES);
 * // boundaries.valid.length === 3
 * // boundaries.invalid === ENUM_INVALID_EDGES
 *
 * test.each(boundaries.valid)('有効ステータス $label を受理すること', ({ value }) => {
 *   expect(parseStatus(value)).toBe(value);
 * });
 * test.each(boundaries.invalid)('無効ステータス $label を拒否すること', ({ value }) => {
 *   expect(() => parseStatus(value)).toThrow();
 * });
 * ```
 */
export function makeEnumBoundaries<T extends string>(
  validValues: readonly T[],
  invalidSamples?: readonly BoundaryCase<string>[],
): { valid: readonly BoundaryCase<T>[]; invalid: readonly BoundaryCase<string>[] } {
  return {
    valid: validValues.map((v) => ({ label: v, value: v })),
    invalid: invalidSamples ?? ENUM_INVALID_EDGES,
  };
}
