# テーブル駆動テストパターンガイド

## このガイドの目的

このガイドは `bun:test` における `test.each` / `it.each` を使ったテーブル駆動テストの標準パターンをまとめたものです。

適用により得られる効果:

- 入力値とその期待結果を 1 箇所（テーブル）に集約し、SSOT（Single Source of Truth）を実現する
- 新しいケースの追加がテーブルへの 1 行追記で完結する
- テスト名に入力値が自動で展開され、失敗時に「何の入力で落ちたか」が一目でわかる

---

## パターン一覧

| パターン | 記法 | 用途 |
|----------|------|------|
| [Pattern A](#pattern-a--タプル配列--s-記法) | タプル配列 + `%s` | シンプルな入力/期待値ペア |
| [Pattern B](#pattern-b--オブジェクト配列--label-記法推奨) | オブジェクト配列 + `$label` | 境界値定数（`BoundaryCase<T>`）の再利用 |
| [Pattern C](#pattern-c--カスタム型オブジェクト配列) | カスタム型オブジェクト配列 | 複数フィールドを持つ複合テストケース |

---

## Pattern A — タプル配列 + `%s` 記法

最もシンプルな形式。`[入力, 期待値]` のタプル配列をそのまま渡す。

### ビフォー（Pattern B ブロック — 変換前）

```typescript
// ❌ 変換前: 同じ関数への expect が散在している
test('無効なプレフィックスを拒否すること', () => {
  expect(isValidBranchName('invalid/branch')).toBe(false);
  expect(isValidBranchName('main')).toBe(false);
  expect(isValidBranchName('release/v1')).toBe(false);
});
```

### アフター（Pattern A — 変換後）

```typescript
// ✅ 変換後: test.each でテーブル化
const invalidPrefixCases: [string, boolean][] = [
  ['invalid/branch', false],
  ['main',           false],
  ['release/v1',     false],
];

test.each(invalidPrefixCases)('isValidBranchName(%s) → false', (input, expected) => {
  expect(isValidBranchName(input)).toBe(expected);
});
```

テスト名に `%s` を書くと、そこにタプルの第 1 要素が展開されます。

### 自動変換コマンド

上記の Pattern A ブロック（単一関数・同一マッチャー・同一期待値・3 件以上の `expect`）は、コードモッドで自動変換できます。

```bash
# dry-run（変更なし — 変換候補を確認するだけ）
bun run codemod:test-each

# 実際に適用（変更する）
bun run codemod:test-each -- --write
```

> **制約**: 真偽が混在するケースや複数引数の関数は `manualReview` に分類され、自動変換されません。  
> その場合は Pattern A または Pattern C を手動で適用してください。

---

## Pattern B — オブジェクト配列 + `$label` 記法（推奨）

`tests/helpers/boundary-values.ts` の `BoundaryCase<T>` 定数を使う際の標準形式です。  
**このプロジェクトにおける推奨パターン**です。

### `BoundaryCase<T>` 型

```typescript
// tests/helpers/boundary-values.ts
export type BoundaryCase<T> = {
  readonly label: string; // テスト名に展開される識別子
  readonly value: T;      // 実際に関数に渡す値
  readonly note?: string; // 補足（省略可）
};
```

### 利用可能な共有定数

| 定数名 | 型 | 内容 |
|--------|----|------|
| `STRING_EDGES` | `BoundaryCase<string>[]` | 空文字・スペース・タブ・複数空白 |
| `BOUNDARY_STRINGS` | `BoundaryCase<string>[]` | 空文字・スペース・タブ・改行 |
| `ID_EDGES` | `BoundaryCase<number>[]` | 0 / -1 / 1（最小正常値） |
| `NUMERIC_ID_BOUNDARIES` | `BoundaryCase<number>[]` | 0 / -1 / `Number.MAX_SAFE_INTEGER` |
| `INVALID_ID_EDGES` | `BoundaryCase<number>[]` | 0 / -1（バリデーション拒否専用） |
| `NULLABLE_ID_EDGES` | `BoundaryCase<number \| null>[]` | `ID_EDGES` + null |
| `NONEXISTENT_ID` | `number` | 999（DB に存在しない ID のセンチネル） |
| `TIME_BOUNDARIES` | `BoundaryCase<number>[]` | epoch=0 / -1 |

### 使い方（`$label` 記法）

```typescript
import { describe, test, expect } from 'bun:test';
import { BOUNDARY_STRINGS } from '../../tests/helpers/boundary-values';
import { resolveUserByEmail } from '../user-resolver';

describe('resolveUserByEmail — 境界値', () => {
  test.each(BOUNDARY_STRINGS)(
    '空文字列境界 $label → null を返すこと',
    async ({ value }) => {
      const result = await resolveUserByEmail(value);
      expect(result).toBeNull();
    },
  );
});
```

`$label` を使うと `BoundaryCase.label` がテスト名に自動展開されます（`toNameTuples` 不要）。

### `toNameTuples` — `%s` 記法との互換変換

`%s` 記法（タプル形式）が必要な場合は `toNameTuples` を使います。

```typescript
import { toNameTuples, ID_EDGES } from '../../tests/helpers/boundary-values';

// BoundaryCase<number>[] → [string, number][] に変換
test.each(toNameTuples(ID_EDGES))(
  'resolveTask(%s) → null を返すこと',
  async (_label, id) => {
    const result = await resolveTask(id);
    expect(result).toBeNull();
  },
);
```

> **`$label` vs `%s`**: どちらも使えますが、`$label`（オブジェクト配列）の方が
> フィールドを直接分割代入でき `toNameTuples` 変換が不要なため、**`$label` を推奨**します。

---

## Pattern C — カスタム型オブジェクト配列

共有定数では表現できない「複数フィールドを持つ複合ケース」に使います。

### 実例（`pr-task-resolver.test.ts` より）

```typescript
import { describe, test, expect } from 'bun:test';

type TitleMatchCase = {
  label: string;
  title: string | null | undefined;
  id: number;
  expected: boolean;
};

const titleMatchCases: TitleMatchCase[] = [
  { label: '[Task-N] 形式マッチ',  title: '[Task-5] fix something',   id: 5, expected: true  },
  { label: '[#N] 形式マッチ',      title: '[#5] fix something',       id: 5, expected: true  },
  { label: 'タスクIDが異なる',     title: '[Task-5] fix',             id: 6, expected: false },
  { label: '無関係なタイトル',     title: 'some unrelated PR title',  id: 5, expected: false },
  { label: 'null タイトル',        title: null,                       id: 5, expected: false },
  { label: '空文字タイトル',       title: '',                         id: 5, expected: false },
  { label: '[Task-0] id=0 境界値', title: '[Task-0] boundary case',   id: 0, expected: true  },
];

describe('titleMatchesTask', () => {
  test.each(titleMatchCases)('$label → $expected', ({ title, id, expected }) => {
    expect(titleMatchesTask(title, id)).toBe(expected);
  });
});
```

### Pattern C の設計ルール

1. **型を定義する** — `type XxxCase = { label: string; ... }` を明示的に宣言する
2. **`label` フィールドを必ず含める** — `$label` でテスト名に展開できる
3. **`expected` フィールドを含める** — `$expected` でテスト名に期待値を表示できる
4. **テーブルとアサーションを分離する** — テーブル配列はテスト関数の外に置く

---

## 境界値定数の追加方法

既存の定数セットにないケースが必要な場合は `tests/helpers/boundary-values.ts` に追加します。

```typescript
// tests/helpers/boundary-values.ts に追加する例
export const URL_BOUNDARY_STRINGS: readonly BoundaryCase<string>[] = [
  { label: '空文字列', value: '' },
  { label: 'httpなし', value: 'example.com', note: 'スキームなし' },
  { label: '最大長URL', value: 'https://' + 'a'.repeat(2000) },
] as const;
```

> **ルール**: `tests/helpers/boundary-values.ts` は **副作用ゼロの純定数ファイル**です。
> `import` 副作用・`mock.module` 呼び出しを含めてはいけません。

---

## `cli-output-filter.test.ts` の手動変換例

真偽が混在するケースはコードモッドが `manualReview` に分類します。  
`[input, expected]` タプルテーブルへ手動で統合します。

### ビフォー（散在した it ブロック）

```typescript
// ❌ 変換前: 複数の it に散在し、真偽が混在している
it('hides raw code-like lines', () => {
  expect(shouldHideRawCliLine('import { foo } from "./bar";')).toBe(true);
  expect(shouldHideRawCliLine('const value = createThing();')).toBe(true);
  expect(shouldHideRawCliLine('short human-readable status')).toBe(false);
});

it('hides codex tool labels', () => {
  expect(shouldHideRawCliLine('調査: {categories.map((cat) => (')).toBe(true);
  expect(shouldHideRawCliLine('調査: timeout exceeded after 30s')).toBe(false);
});
```

### アフター（統合テーブル — 手動変換）

```typescript
// ✅ 変換後: [input, expected] テーブルに統合
const hideLineCases: [string, boolean][] = [
  // コードライン → 非表示
  ['import { foo } from "./bar";',               true],
  ['const value = createThing();',               true],
  ['調査: {categories.map((cat) => (',           true],
  // 人間可読テキスト → 表示
  ['short human-readable status',                false],
  ['調査: timeout exceeded after 30s',           false],
];

test.each(hideLineCases)(
  'shouldHideRawCliLine(%s) → %s',
  (input, expected) => {
    expect(shouldHideRawCliLine(input)).toBe(expected);
  },
);
```

---

## アンチパターン

### NG: 同じ関数に対する expect の散在

```typescript
// ❌ 変換候補 — ケースを追加するたびに test ブロックを増やす
test('無効なプレフィックスを拒否すること', () => {
  expect(isValidBranchName('invalid/branch')).toBe(false);
  expect(isValidBranchName('main')).toBe(false);
});

test('特殊文字を含む名前を拒否すること', () => {
  expect(isValidBranchName('feature/add~auth')).toBe(false);
  expect(isValidBranchName('feature/add^auth')).toBe(false);
});
```

### NG: テーブルを関数内部に置く

```typescript
// ❌ テーブルが test のコールバック内にあると読みにくい
test.each([['a', true], ['b', false]])('...', (input, expected) => {
  const cases = [/* ... */]; // ← これはアンチパターンではないが、外に出す方が見やすい
  expect(fn(input)).toBe(expected);
});
```

---

## まとめ: どのパターンを使うか

```
新しいテストケースを追加したい
├── 境界値定数（STRING_EDGES / ID_EDGES 等）が使える？
│     └── YES → Pattern B（$label 記法）+ 共有定数を import
└── NO → カスタムケース定義が必要
           ├── 入力1つ・期待値1つ → Pattern A（タプル配列 + %s 記法）
           └── 複数フィールド → Pattern C（型付きオブジェクト配列 + $label 記法）

既存テストをテーブル化したい
├── 自動変換対象か確認 → bun run codemod:test-each（dry-run）
├── 変換可能 → bun run codemod:test-each -- --write で適用
└── manualReview → Pattern A または Pattern C で手動変換
```

---

## 関連ドキュメント

- **境界値定数の完全リスト**: `docs/boundary-guide.generated.md`（`bun run gen:boundary-guide` で再生成）
- **境界値定数の実装**: `rapitas-backend/tests/helpers/boundary-values.ts`
- **コードモッド（自動変換）**: `rapitas-backend/scripts/codemods/README.md`
