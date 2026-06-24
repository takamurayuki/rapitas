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

## ユーティリティ関数

### `toNameTuples<T>(cases)`

`BoundaryCase<T>[]` を `it.each` 用 `[label, value]` タプル配列に変換する。
bun:test の `%s` 置換は primitive 前提のため、本関数でタプル化することで
ラベルを正しく表示できる。
