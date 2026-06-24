# テストデータドリブンガイド

> **このガイドについて**: resolver テスト・サービステストで確立した `test.each` + `boundary-values.ts`(SSOT) パターンを解説する手動メンテのガイドです。
> 境界値定数の具体値リファレンスは自動生成の [`boundary-guide.generated.md`](./boundary-guide.generated.md) を参照してください。

---

## 目的とスコープ

このガイドは以下を対象とします。

- DB-backed resolver 関数の null パス検証（パターン A）
- ドメイン固有の入出力テーブル（パターン B）
- 共有 SSOT 境界値定数を使った境界値テスト（パターン C）
- 単純な入出力アサーションが散在するサービステスト（パターン D）

プロダクションコードの変更は対象外です。

---

## パターン早見表と選択フロー

```
テストしたいものは何か？
│
├── DB-backed resolver が null を返すケース
│   └── → パターン A: nullReturnCases テーブル
│
├── ドメイン固有のロジック（入力 → 期待値 の対応表）
│   └── → パターン B: ドメイン入出力テーブル
│
├── 共有 SSOT から境界値を引いてくる
│   └── → パターン C: 共有 EDGES 定数
│
└── 純関数の同種アサーションが複数 it に散在している
    └── → パターン D: 単純入出力テーブル
```

| パターン | 用途 | SSOT | 実例ファイル |
| --- | --- | --- | --- |
| A | DB-backed resolver の null パス | ローカル定数 | `services/task/task-resolver.test.ts` |
| B | ドメイン固有入出力テーブル | ローカル定数 | `services/github/pr-task-resolver.test.ts` |
| C | 共有 EDGES 定数で境界値テスト | `tests/helpers/boundary-values.ts` | `services/core/auth-session-resolver.test.ts` |
| D | 純関数の同種 in→out アサーション | ローカル定数 | `tests/utils/branch-name-generator.test.ts`, `tests/services/cli-output-filter.test.ts` |

---

## パターン A — `nullReturnCases` テーブル（DB-backed resolver の null パス）

**使うとき**: prisma の `findUnique` / `findFirst` を呼ぶ resolver 関数で、「not found」「DB error」「境界値 ID/文字列」など複数の null パスをまとめて検証したい場合。

```ts
import { describe, test, mock, beforeEach } from 'bun:test';

// ローカルに型とテーブルを定義する
type NullReturnCase = { label: string; id: number; setup: (m: ReturnType<typeof mock>) => void };

const nullReturnCases: NullReturnCase[] = [
  { label: 'not found',             id: 999,                   setup: (m) => m.mockResolvedValueOnce(null) },
  { label: 'DB error',              id: 1,                     setup: (m) => m.mockRejectedValueOnce(new Error('DB error')) },
  { label: 'id=0 (boundary)',       id: 0,                     setup: (m) => m.mockResolvedValueOnce(null) },
  { label: 'id=-1 (negative)',      id: -1,                    setup: (m) => m.mockResolvedValueOnce(null) },
  { label: 'id=MAX_SAFE_INTEGER',   id: Number.MAX_SAFE_INTEGER, setup: (m) => m.mockResolvedValueOnce(null) },
];

test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
  setup(mockXxxFindUnique);
  const result = await resolveXxx(id);
  expect(result).toBeNull();
});
```

**ポイント**:

- `$label` で各ケースに人間可読なテスト名が付く（`[object Object]` にならない）
- `setup` コールバックで mock の振る舞いをケースごとに切り替える
- `beforeEach` で mock をリセットし、各ケースが独立して動作することを確認する

**実例**: `services/task/task-resolver.test.ts:56–69`

---

## パターン B — ドメイン入出力テーブル（固有ロジック）

**使うとき**: resolver や純粋関数で「この入力ならこの出力」という対応表が明確で、3 件以上同じパターンの `expect` が並ぶ場合。

```ts
type TitleMatchCase = {
  label: string;
  title: string | null | undefined;
  id: number;
  expected: boolean;
};

const titleMatchCases: TitleMatchCase[] = [
  { label: '[Task-N] 形式マッチ', title: '[Task-5] fix something', id: 5, expected: true },
  { label: '[#N] 形式マッチ',    title: '[#5] fix something',     id: 5, expected: true },
  { label: 'タスクIDが異なる',   title: '[Task-5] fix',           id: 6, expected: false },
  { label: 'null タイトル',      title: null,                     id: 5, expected: false },
  { label: '空文字タイトル',     title: '',                       id: 5, expected: false },
];

test.each(titleMatchCases)('$label → $expected', ({ title, id, expected }) => {
  expect(titleMatchesTask(title, id)).toBe(expected);
});
```

**ポイント**:

- 型エイリアスでテーブル行の構造を明示する
- `$expected` / `$label` などをテスト名に埋め込み、CI 出力を読みやすくする
- 同種アサーションのみテーブル化する。異種アサーション（`toContain` と `toBe` が混在など）は個別 `it` のままが明快

**実例**: `services/github/pr-task-resolver.test.ts:58–85`

---

## パターン C — 共有 EDGES 定数（境界値 SSOT）

**使うとき**: 空文字・境界 ID など、複数のテストファイルで同じ境界値を再利用したい場合。`tests/helpers/boundary-values.ts` から定数をインポートする。

```ts
import { STRING_EDGES, ID_EDGES, toNameTuples } from '../../tests/helpers/boundary-values';

// オブジェクト形式（$label が使える）
test.each(STRING_EDGES)('空文字列境界 $label → null を返すこと', async ({ value }) => {
  const result = await resolveUserByEmail(value);
  expect(result).toBeNull();
});

// タプル形式（%s が使える、bun:test 互換）
it.each(toNameTuples(ID_EDGES))('境界 ID (%s) → null を返すこと', async (_label, value) => {
  const result = await resolveTask(value);
  expect(result).toBeNull();
});
```

**利用可能な定数一覧**: [`boundary-guide.generated.md`](./boundary-guide.generated.md) を参照。

| 定数名 | 値の型 | 主な用途 |
| --- | --- | --- |
| `STRING_EDGES` | `string` | 文字列引数 resolver の空文字・空白境界 |
| `ID_EDGES` | `number` | 数値 ID 引数の 0/-1/1 小規模セット |
| `NUMERIC_ID_BOUNDARIES` | `number` | MAX_SAFE_INTEGER を含む ID 境界 |
| `BOUNDARY_STRINGS` | `string` | 改行を含む文字列境界（email/token 等） |
| `NULLABLE_ID_EDGES` | `number \| null` | nullable 外部キー引数 |
| `INVALID_ID_EDGES` | `number` | バリデーション拒否系（0/-1 のみ） |
| `NONEXISTENT_ID` | `number` | 存在しない ID のセンチネル値（999） |

**ポイント**:

- `toNameTuples` は `BoundaryCase<T>[]` を `[label, value][]` に変換する。bun:test の `%s` は primitive 前提のため、オブジェクト配列をそのまま渡すと `[object Object]` と表示される
- `$label` 形式（オブジェクト配列）と `%s` 形式（タプル配列）は混在しないようにする

**実例**: `services/core/auth-session-resolver.test.ts:69–113`

---

## パターン D — 純関数の単純入出力テーブル

**使うとき**: DB mock なしの純関数で、「入力文字列 → `boolean`」「入力文字列 → 出力文字列」のような単純な `toBe` アサーションが複数の `it` ブロックに散在している場合。

```ts
// 例: isValidBranchName の全ケースをテーブル化
type ValidCase = { name: string; input: string; expected: boolean };

const isValidBranchNameCases: ValidCase[] = [
  { name: 'feature/add-auth（有効なfeature/プレフィックス）', input: 'feature/add-auth', expected: true },
  { name: '空文字列', input: '', expected: false },
  { name: 'スペースを含む', input: 'feature/add auth', expected: false },
  // ...
];

describe('isValidBranchName', () => {
  test.each(isValidBranchNameCases)('$name → $expected', ({ input, expected }) => {
    expect(isValidBranchName(input)).toBe(expected);
  });
});
```

**ポイント**:

- 同種アサーション（同じ関数・同じ検証メソッド）のみをテーブル化する
- 異種アサーション（`length` チェック・`typeof` チェック等が混在）は個別 `it` で残す
- **カバレッジを下げてはならない**: テーブル化前後でアサーション件数が同等以上であることを確認する

**実例**: `tests/utils/branch-name-generator.test.ts`, `tests/services/cli-output-filter.test.ts`

---

## 新規境界値定数を追加する手順

> **ルール**: 新しい境界値定数は**消費者（テストファイル）と必ずセットで追加**する。消費者のない定数は SSOT を汚染する（YAGNI）。

```
1. tests/helpers/boundary-values.ts に定数を追加する
   - BoundaryCase<T> 型を使う
   - JSDoc で「対象」「期待される挙動」「NOTE」を明記する

2. 消費するテストファイルで import して test.each に使う

3. 境界値リファレンスを再生成する
   bun run gen:boundary-guide

4. CI gate の確認
   bun run check:boundary-guide:changed  # ドリフト検出
```

> `TIME_BOUNDARIES` のような「定義のみ・消費者ゼロ」の定数は追加しない。消費が生じたときに消費者のコミットと同時に追加する。

---

## `prefer-test-each` codemod の使い方と限界

`scripts/codemods/prefer-test-each.ts` は同一パターンの `it()` ブロックを自動で `test.each` に変換するツールです。

```bash
bun run scripts/codemods/prefer-test-each.ts --file tests/utils/xxx.test.ts
```

**限界**:

- `async` コールバックを含むテストブロックは変換できない（手動対応が必要）
- 複数の `mock.mockReset()` が必要なケースは変換後に崩れる可能性がある
- 変換結果は必ず手動で検証し、カバレッジが低下していないことを確認する

---

## 実例ファイル一覧

### パターン A・C: DB-backed resolver テスト

| ファイル | パターン | 使用定数 |
| --- | --- | --- |
| `services/task/task-resolver.test.ts` | A + C | `ID_EDGES`, `NUMERIC_ID_BOUNDARIES` |
| `services/agents/agent-session-resolver.test.ts` | A + C | `ID_EDGES` |
| `services/core/auth-session-resolver.test.ts` | A + C | `STRING_EDGES`, `BOUNDARY_STRINGS` |
| `services/core/user-resolver.test.ts` | A + C | `STRING_EDGES`, `BOUNDARY_STRINGS` |
| `services/github/pr-task-resolver.test.ts` | B + C | `NUMERIC_ID_BOUNDARIES` |

### 自動生成された境界値テスト

| ファイル | 対象関数数 |
| --- | --- |
| `services/task/task-resolver.boundary.test.ts` | 12 |
| `services/agents/agent-session-resolver.boundary.test.ts` | 3 |
| `services/core/auth-session-resolver.boundary.test.ts` | 1 |
| `services/core/user-resolver.boundary.test.ts` | 1 |

> 自動生成ファイルは `scripts/gen-resolver-boundary-tests.ts` で生成されます。手動編集不可。

### パターン D: 純関数テスト（実例）

| ファイル | 変換した関数 |
| --- | --- |
| `tests/utils/branch-name-generator.test.ts` | `isValidBranchName`, `sanitizeBranchName`（単純 toBe ケース） |
| `tests/services/cli-output-filter.test.ts` | `shouldHideRawCliLine` |

---

## よくある落とし穴

| 落とし穴 | 対策 |
| --- | --- |
| オブジェクト配列をそのまま `test.each` に渡すと `[object Object]` と表示される | `$label` / `{ label }` 形式を使うか、`toNameTuples` でタプル化する |
| bun:test の `mock.module` はプロセスグローバル | 複数テストファイルの**同時実行**で mock が衝突する。ファイル単位で実行すれば問題なし |
| テーブル化でアサーション件数が減った | リファクタはカバレッジを下げてはならない。テーブル化前後でケース数を突合する |
| 異種アサーション（`length` + `toBe` 混在）を無理にテーブル化 | 同種アサーションのみテーブル化する。異種は個別 `it` のままが明快 |
