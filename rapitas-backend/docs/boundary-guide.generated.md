# Resolver 境界値ガイド

> 自動生成ファイル — `bun run gen:boundary-guide` で再生成。手動編集不可。  
> ソース: `scripts/gen-boundary-guide.ts`  
> SSOT: `tests/helpers/boundary-values.ts`

## 概要

`tests/helpers/boundary-values.ts` に定義された境界値定数のリファレンス。
`it.each` / `test.each` パターンで resolver の境界値テストを記述する際に使用する。

## BoundaryCase\<T\> 型

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `label` | `string` | テスト名 (`%s` / `$label`) に表示される識別子 |
| `value` | `T` | 境界値の実値 |
| `note` | `string \| undefined` | 補足・制約（省略可） |

## 定数一覧

### `STRING_EDGES`

文字列引数 resolver 向けの境界値定数。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| 空文字列 | `""` (空文字) | DBレコードが存在しない前提でmockがnullを返す |
| 半角スペース | `" "` | DBレコードが存在しない前提でmockがnullを返す |
| タブ文字 | `"\t"` | DBレコードが存在しない前提でmockがnullを返す |
| 複数空白 | `"  "` | DBレコードが存在しない前提でmockがnullを返す |

### `ID_EDGES`

数値 ID 引数 resolver 向けの境界値定数（0/-1/1 の小規模セット）。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |
| id=1（最小正常値） | `1` |  |

### `NUMERIC_ID_BOUNDARIES`

数値型 ID の境界値セット（ID_EDGES の拡張版 — MAX_SAFE_INTEGER を含む）。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| ゼロ | `0` |  |
| 負数 | `-1` |  |
| MAX_SAFE_INTEGER | `9007199254740991` |  |

### `BOUNDARY_STRINGS`

文字列型フィールドの境界値セット（改行を含む）。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| 空文字 | `""` (空文字) |  |
| 空白のみ | `" "` |  |
| タブ | `"\t"` |  |
| 改行 | `"\n"` |  |
| CRLF改行 | `"\r\n"` |  |

### `TIME_BOUNDARIES`

時刻（epoch ミリ秒）の境界値セット。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| epoch | `0` |  |
| 負のepoch | `-1` |  |

### `NULLABLE_ID_EDGES`

nullable 数値 ID 引数 resolver 向けの境界値定数。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |
| id=1（最小正常値） | `1` |  |
| null | `null` |  |

### `INVALID_ID_EDGES`

バリデーションで拒否されるべき非正 ID の境界値セット。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |

### `NONEXISTENT_ID`

DB に存在しないことを表すセンチネル ID。

| 値 |
| --- |
| `999` |

### `DATE_EDGES`

日付文字列の境界値セット（ISO 8601 形式）。将来的に日付文字列引数を取る resolver 向け。
ISO 8601 文字列で保持し、テスト側で `new Date(value)` に変換して使用する。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| Unix epoch (ISO) | `"1970-01-01T00:00:00.000Z"` | 定義のみ・将来消費 — new Date(value).getTime() === 0 |
| epoch 直前 (ISO) | `"1969-12-31T23:59:59.999Z"` | 定義のみ・将来消費 — new Date(value).getTime() === -1 |
| JS Date 最大値 (ISO) | `"+275760-09-13T00:00:00.000Z"` | 定義のみ・将来消費 — new Date(value).getTime() === 8640000000000000 |
| 空文字（無効パース） | `""` (空文字) | new Date("") → Invalid Date |

### `ENUM_INVALID_EDGES`

Enum 型引数に対する無効値の境界値セット。`makeEnumBoundaries()` の `invalid` 省略時のデフォルト値として使用する。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| 空文字 | `""` (空文字) |  |
| 未知の文字列 | `"invalid_status"` |  |
| 大文字化 | `"INVALID"` |  |
| 空白のみ | `" "` |  |

### `FLOAT_EDGES`

浮動小数点数の境界値セット（NaN / Infinity / EPSILON を含む）。将来的に浮動小数点引数を取る関数向けに定義のみ用意。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| ゼロ | `0` | 定義のみ・将来消費 |
| 負のゼロ (-0) | `0` | 定義のみ・将来消費 — Object.is(-0, 0) === false |
| NaN | `NaN` | 定義のみ・将来消費 — Number.isNaN(v) で確認 |
| 正の無限大 | `Infinity` | 定義のみ・将来消費 |
| 負の無限大 | `-Infinity` | 定義のみ・将来消費 |
| EPSILON | `2.220446049250313e-16` | 定義のみ・将来消費 — 浮動小数点比較の最小有効差 |

### `PG_INT_BOUNDARIES`

PostgreSQL INTEGER (INT4) 型の境界値セット（-2147483648 〜 2147483647）。`NUMERIC_ID_BOUNDARIES`（MAX_SAFE_INTEGER）との差別化設計。

| ラベル | 値 | 補足 |
| --- | --- | --- |
| INT4 最小値 | `-2147483648` | PostgreSQL INTEGER の下限（MIN_INT4） |
| INT4 最大値 | `2147483647` | PostgreSQL INTEGER の上限（MAX_INT4） |
| INT4 オーバーフロー | `2147483648` | MAX_INT4 + 1。Prisma が例外を投げる可能性がある |
| ゼロ | `0` |  |

## ユーティリティ関数

### `toNameTuples<T>(cases)`

`BoundaryCase<T>[]` を `it.each` 用 `[label, value]` タプル配列に変換する。
bun:test の `%s` 置換は primitive 前提のため、本関数でタプル化することで
ラベルを正しく表示できる。

## 定数の追加手順

新しい境界値定数を `tests/helpers/boundary-values.ts` に追加する際は以下の 3 ステップに従う。

### ステップ 1 — `boundary-values.ts` に定数を追加

JSDoc の最初の行がガイドのセクション説明として自動反映される。

```ts
/**
 * 〈一行説明〉（ガイドに表示される）
 */
export const MY_NEW_EDGES: readonly BoundaryCase<MyType>[] = [
  { label: '〈境界ラベル〉', value: /* 境界値 */ },
];
```

### ステップ 2 — `gen-boundary-guide.ts` に定数を登録

以下の 4 箇所を更新する:

1. **`import` 文** に定数名を追加（ファイル先頭）
2. **`BoundaryGuideInput` インターフェース** に型フィールドを追加
3. **`DEFAULT_DESCRIPTIONS`** にフォールバック説明文を追加
4. **`generateGuideContent`** と **`checkDrift`** 内の `input` オブジェクトに追加

### ステップ 3 — ガイドを再生成してコミット

```sh
bun run gen:boundary-guide
```

生成された `docs/boundary-guide.generated.md` を必ず同一コミットに含めること。  
コミット漏れがあると CI の `checkDrift` テストが失敗する。
