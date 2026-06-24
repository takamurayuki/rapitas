# 境界値テストガイド

> 自動生成ファイル — 手動編集不可。再生成: `bun run gen:boundary-guide`  
> ソース: `tests/helpers/boundary-values.ts`

## 型定義

### `BoundaryCase<T>`

境界値テストケースを表す型。

```ts
type BoundaryCase<T> = {
  readonly label: string;   // テスト名に表示される人間可読な識別子
  readonly value: T;        // 境界値本体（resolver に渡す実値）
  readonly note?: string;   // 暗黙前提や制約などの補足（省略可）
};
```

## 配列定数

### `STRING_EDGES`

文字列引数 resolver 向けの境界値定数。

空文字列・空白系を網羅し、「クラッシュせず null を返す」ことを
resolver テストで共通検証するための標準セット（複数空白含む）。

NOTE: 期待結果は常に「DB mock が null を返す」前提に依存する。
これは「DB にマッチするレコードが存在しない」暗黙前提であり、
各テストの note フィールドに明示している。

| label | value | note |
| --- | --- | --- |
| 空文字列 | `""` | DBレコードが存在しない前提でmockがnullを返す |
| 半角スペース | `" "` | DBレコードが存在しない前提でmockがnullを返す |
| タブ文字 | `"\t"` | DBレコードが存在しない前提でmockがnullを返す |
| 複数空白 | `"  "` | DBレコードが存在しない前提でmockがnullを返す |

### `ID_EDGES`

数値 ID 引数 resolver 向けの境界値定数（0/-1/1 の小規模セット）。

0（ゼロ境界）・-1（負数）・1（最小正常値の対照群）を含む。
各 resolver は値を `where.id` / `where.configId` に素通しし、
クラッシュせず null を返すことを検証するための標準セット。

NOTE: PostgreSQL INTEGER は 32bit (上限 2147483647) のため、
Number.MAX_SAFE_INTEGER は除外している。大きい ID 境界が必要な場合は
NUMERIC_ID_BOUNDARIES を使用すること。

| label | value | note |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |
| id=1（最小正常値） | `1` |  |

### `NUMERIC_ID_BOUNDARIES`

数値型 ID の境界値セット（ID_EDGES の拡張版 — MAX_SAFE_INTEGER を含む）。

対象: resolver の id 引数（taskId / configId / sessionId 等）
期待される挙動: いずれの値でも resolver が例外を投げず null を返すこと（堅牢性確認）

| label | value | note |
| --- | --- | --- |
| ゼロ | `0` |  |
| 負数 | `-1` |  |
| MAX_SAFE_INTEGER | `9007199254740991` |  |

### `BOUNDARY_STRINGS`

文字列型フィールドの境界値セット（改行を含む）。

対象: email / token / username 等の文字列引数
期待される挙動: いずれの値でも resolver が例外を投げず null を返すこと（現挙動の回帰固定）

NOTE: debug-log-parsers.test.ts の edgeCases=['',' ','\n','\t'] を定数化・共有化したもの。

| label | value | note |
| --- | --- | --- |
| 空文字 | `""` |  |
| 空白のみ | `" "` |  |
| タブ | `"\t"` |  |
| 改行 | `"\n"` |  |

### `TIME_BOUNDARIES`

時刻（epoch ミリ秒）の境界値セット。

対象: 将来的に時刻引数を取る resolver 関数（現状の resolver には時刻引数なし）
定義のみ用意し、消費は将来のテスト追加時に行う。
境界値漏れ防止の品質基準として残す。

| label | value | note |
| --- | --- | --- |
| epoch | `0` |  |
| 負のepoch | `-1` |  |

### `NULLABLE_ID_EDGES`

nullable 数値 ID 引数 resolver 向けの境界値定数。

ID_EDGES に null を追加した拡張版。
`number | null` 型の外部キー引数（linkedTaskId 等）のテストに使用する。

| label | value | note |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |
| id=1（最小正常値） | `1` |  |
| null | `null` |  |

### `INVALID_ID_EDGES`

バリデーションで拒否されるべき非正 ID の境界値セット。

0（ゼロ境界）と -1（負数）を含む。`ID_EDGES` は正常値 `1` も含むため、
「バリデーション拒否系」テストには本定数を使用する。
拒否対象（≤0）を明示的に宣言する目的で `ID_EDGES.filter(...)` の派生ではなく独立した定数とする。

| label | value | note |
| --- | --- | --- |
| id=0（ゼロ境界） | `0` |  |
| id=-1（負数） | `-1` |  |

## スカラー定数

DB に存在しないことを表すセンチネル ID。

mock が null を返す前提の「存在しないID」として使用する。
テストフィクスチャとして汎用的に使う `999` のような値ではなく、
「このIDはDBに存在しない」という意図を明示するための共有定数。

| 定数名 | 値 |
| --- | --- |
| `NONEXISTENT_ID` | `999` |

## ユーティリティ

### `toNameTuples<T>(cases)`

BoundaryCase<T> 配列を `it.each` 用 `[label, value]` タプル配列に変換する。

bun:test の `%s` 置換は primitive 前提のため、オブジェクト配列を直接渡すと
`[object Object]` と表示される。本関数でタプル化することで
`it.each(toNameTuples(EDGES))('...(%s)...', (_label, value) => ...)` の形式で
`%s` に `label` 文字列が正しく表示される。
