# eslint-rules — カスタム ESLint ルール

このディレクトリはプロジェクト固有の ESLint ルールを格納します。  
各ルールは **`eslint-shared.mjs`** 経由でプロジェクト全体に適用されます。

---

## 実装済みルール一覧

| ファイル | ルール名 | 概要 |
|---|---|---|
| `no-raw-prisma-insensitive.mjs` | `no-raw-prisma-insensitive` | Prisma クエリ内の生 `mode: 'insensitive'` を禁止。SQLite は非サポートのため `getInsensitiveMode()` を使う必要がある |

---

## テスト実行

```bash
# このルールのテストのみ実行
bun test eslint-rules/no-raw-prisma-insensitive.test.mjs

# CI ゲートスイート全体（他テストと合わせて実行）
bun run test:ci
```

---

## 新規ルールの追加手順

### 1. ルール本体を作成する

`eslint-rules/<rule-name>.mjs` を作成する。雛形:

```js
/**
 * <rule-name>
 *
 * <1行: このルールが検出するもの>
 * <1行: このルールが対象 "しない" もの（誤検知除外の境界）>
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem', // 'problem' | 'suggestion' | 'layout'
    docs: {
      description: '<短い説明（eslint --rule-info 表示用）>',
      recommended: true,
    },
    messages: {
      myMessageId: '<エラーメッセージ本文>',
    },
    schema: [], // ルールオプションなしの場合は空配列
    fixable: null, // 自動修正ありなら 'code'
  },

  create(context) {
    return {
      // AST ノードビジター
      Property(node) {
        // ... 検出ロジック ...
        context.report({ node, messageId: 'myMessageId' });
      },
    };
  },
};

export default rule;
```

- **パーサ非依存**にする（TypeScript 構文への対応は `TSAsExpression` 等で分岐）
- 型情報が不要なら `@typescript-eslint/parser` なしで実装できる

### 2. テストファイルを作成する

`eslint-rules/<rule-name>.test.mjs` を作成する。雛形:

```js
/**
 * <rule-name>.test.mjs
 *
 * Unit tests for the <rule-name> ESLint rule.
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import rule from './<rule-name>.mjs';

// NOTE: RuleTester.run() は内部で describe() を呼ぶため bun:test の it() 内で使えない。
// Linter.verify() を直接呼ぶことで各ケースを個別の it() として可視化する。
function runRule(code, extraLanguageOptions = {}) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { local: { rules: { '<rule-name>': rule } } },
    rules: { 'local/<rule-name>': 'error' },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', ...extraLanguageOptions },
  });
}

describe('<rule-name> — valid', () => {
  it('① 正常なコード', () => {
    expect(runRule(`/* 正常なコード */`)).toHaveLength(0);
  });
});

describe('<rule-name> — invalid', () => {
  it('① 違反コード', () => {
    const msgs = runRule(`/* 違反コード */`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('myMessageId');
  });
});
```

### 3. ESLint 設定に登録する

`eslint-shared.mjs` の `plugins` と `rules` に追加する:

```js
import myRule from './eslint-rules/<rule-name>.mjs';

export default [
  {
    plugins: {
      local: {
        rules: {
          'no-raw-prisma-insensitive': noRawPrismaInsensitive,
          '<rule-name>': myRule, // ← 追加
        },
      },
    },
    rules: {
      'local/no-raw-prisma-insensitive': 'error',
      'local/<rule-name>': 'error', // ← 追加
    },
  },
];
```

### 4. CI ゲートに登録する

`scripts/ci-gate-tests.txt` にテストファイルのパスを追記する（追記前に `bun run test:ci` でローカルグリーンを確認）:

```
eslint-rules/<rule-name>.test.mjs
```

---

## 設計上の注意

- **TypeScript 構文への対応**: espree（デフォルト）は `as const` などの TS 構文を解析できない。TypeScript 固有のコードパスをテストするには、テストファイル内で `@typescript-eslint/parser` を使った別の Linter インスタンスを用意する（`no-raw-prisma-insensitive.test.mjs` の末尾を参照）。
- **誤検知を最小化**: `mode: 'insensitive'` 系のルールのように、同名プロパティが別コンテキストで有効な場合は境界条件をテストに含める。
- **`fixable`**: 自動修正ありのルールは `create()` 内で `fixer.replaceText()` 等を返す。修正は壊れにくいもの（単純な置換）のみ自動化する。
