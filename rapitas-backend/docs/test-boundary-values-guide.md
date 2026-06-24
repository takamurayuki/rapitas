<!-- このファイルは自動生成されます。手動編集禁止。-->
<!-- 再生成: `bun run gen:boundary-guide` (ソース: scripts/gen-boundary-guide.ts) -->

# テスト境界値定数 選択ガイド

`tests/helpers/boundary-values.ts` が提供する境界値定数の一覧と選択基準。
新しいテストファイルを作成する際は、このガイドを参照して適切な定数セットを選択すること。

## 選択フロー

```
引数の型は何か？
├── string
│   ├── 改行（\n）が有効な入力フィールドか？
│   │   ├── YES → BOUNDARY_STRINGS
│   │   └── NO  → STRING_EDGES（推奨デフォルト）
├── number
│   ├── Number.MAX_SAFE_INTEGER での堅牢性を検証したいか？
│   │   ├── YES → NUMERIC_ID_BOUNDARIES
│   │   └── NO  → ID_EDGES（推奨デフォルト）
│   └── 将来の時刻引数（現状は resolver に時刻引数なし）
│       └── TIME_BOUNDARIES（reserved — 現状未使用）
└── number | null
    └── NULLABLE_ID_EDGES（外部キー等の nullable ID 引数）
```

## 定数一覧

### 文字列 (`string`)

| 定数名 | 改行含む | 大値含む | 自動生成 | 状態 | 用途 |
|--------|----------|----------|----------|------|------|
| `BOUNDARY_STRINGS` | ✅ | — | — | active | 改行（\n）を有効入力として扱う文字列フィールド向け。email 等の改行禁止フィールドには STRING_EDGES を使用すること。 |
| `STRING_EDGES` | — | — | ✅ | active | 文字列引数 resolver 向けの標準セット。空文字・空白系を網羅し改行を含まない入力フィールド（email / token 等）に使用する。 |

### 数値 (`number`)

| 定数名 | 改行含む | 大値含む | 自動生成 | 状態 | 用途 |
|--------|----------|----------|----------|------|------|
| `ID_EDGES` | — | — | ✅ | active | 数値 ID 引数 resolver 向けの標準セット（0/-1/1）。PostgreSQL INTEGER 範囲内の小規模境界値テストに使用する。 |
| `NUMERIC_ID_BOUNDARIES` | — | ✅ | — | active | ID_EDGES の拡張版（Number.MAX_SAFE_INTEGER を追加）。数値上限での resolver 堅牢性を検証する場合に使用する。 |
| `TIME_BOUNDARIES` | — | — | — | ⚠️ reserved | 将来的に時刻（epoch ミリ秒）引数を取る resolver 向けに予約された定数。現状の resolver には時刻引数がなく、消費箇所はない。 |

### 数値またはnull (`number \| null`)

| 定数名 | 改行含む | 大値含む | 自動生成 | 状態 | 用途 |
|--------|----------|----------|----------|------|------|
| `NULLABLE_ID_EDGES` | — | — | ✅ | active | number | null 型の外部キー引数（linkedTaskId 等）向け。ID_EDGES に null を追加した拡張版。gen-resolver-boundary-tests が自動選択する。 |

## `STRING_EDGES` vs `BOUNDARY_STRINGS` の使い分け

両者はともに `string` 型引数向けの境界値定数だが、**改行文字（`\n`）を含むかどうか**で使い分ける。

| 定数名 | `\n` を含む | 対象フィールドの例 |
|--------|------------|-------------------|
| `STRING_EDGES` | ❌（改行なし） | email, token, username, slug |
| `BOUNDARY_STRINGS` | ✅（改行あり） | メモ, 本文, 複数行テキスト |

> **原則**: 判断に迷ったら `STRING_EDGES` を使う。改行が入力として意味を持つフィールドのみ `BOUNDARY_STRINGS` を選ぶ。

## `gen:boundary-tests` での自動選択

`bun run gen:boundary-tests` は `*-resolver.ts` を解析し、引数型に応じて以下の定数を自動選択する。

| 引数型 | 自動選択される定数 |
|--------|-------------------|
| `number` | `ID_EDGES` |
| `number | null` | `NULLABLE_ID_EDGES` |
| `string` | `STRING_EDGES` |

手動テストで別の定数（`NUMERIC_ID_BOUNDARIES` 等）が必要な場合は、`.boundary.test.ts` ではなく通常のテストファイルに追記する。
