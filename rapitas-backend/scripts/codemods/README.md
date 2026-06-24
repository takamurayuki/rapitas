# scripts/codemods — コードモッド（自動コード変換）

このディレクトリは TypeScript ソースコードを一括変換するコードモッドを格納します。  
各コードモッドは `lib/codemod-runner.ts` の共有インフラを使って dry-run / write モードで実行できます。

---

## 実装済みコードモッド一覧

| スクリプト | npm script | 概要 |
|---|---|---|
| `insensitive-mode.ts` | ― | Pattern A (`isPostgres ? { mode: 'insensitive' as const } : {}`) → `getInsensitiveMode()` に置換 |
| `insensitive-spread.ts` | `codemod:insensitive-spread` | Pattern B1（中間変数 `const insensitive = getInsensitiveMode()`）をスプレッドにインライン化 |
| `spec-array.ts` | `codemod:spec-array` | `JSON.parse(x \|\| '[]')` → `parseSpecArray(x)` に置換 |
| `prisma-singleton.ts` | `codemod:prisma` | `new PrismaClient()` → `prisma` シングルトンに置換 |
| `response-helper.ts` | `codemod:response` | `{ success: true, data: x }` → `createResponse(x)` に置換 |

```bash
# 個別実行（dry-run）
bun run codemod:insensitive-spread
bun run codemod:spec-array
bun run codemod:prisma
bun run codemod:response

# 全コードモッド連続実行（dry-run）
bun run codemod:all
```

---

## テスト実行

```bash
# コードモッドテストのみ実行
bun test scripts/codemods/__tests__/codemod-runner.test.ts

# CI ゲートスイート全体（他テストと合わせて実行）
bun run test:ci
```

---

## `lib/codemod-runner.ts` API 早見表

### `walkTs(root, extensions?, excludeDirs?): string[]`

ディレクトリを再帰走査して TypeScript ファイルのパスを返す。  
`node_modules`・`dist`・`__tests__`・`generated` 等を自動除外。

```ts
const files = walkTs(join(__dirname, '../../'));
```

### `ensureImport(src, named, modulePath): string`

指定の named export の import 文が存在しなければ末尾 import 行の後ろに追記する。  
重複追加しない（冪等）。

```ts
newContent = ensureImport(content, 'parseSpecArray', '../utils/common/spec-array');
```

### `relativeImportPath(fromFile, toModule): string`

`fromFile` から `toModule` への相対パス文字列（`./` または `../` 始まり）を返す。

```ts
const importPath = relativeImportPath(filePath, join(root, 'utils/common/spec-array'));
```

### `runCodemod(transform, options): CodemodSummary`

ファイルツリーを走査して `transform` を各ファイルに適用し、要約を返す。

```ts
const summary = runCodemod(transformSpecArray, {
  roots: [join(__dirname, '../../')],
  label: 'spec-array',
  write: false, // true にすると実際に上書き
});
console.log(`changed: ${summary.changed}, unchanged: ${summary.unchanged}`);
```

### `TransformInput` / `TransformResult` インターフェース

```ts
interface TransformInput {
  filePath: string; // 絶対パス
  content: string;  // 現在のファイル内容
}

interface TransformResult {
  newContent: string;    // 変換後の内容（未変更時は入力と同じ）
  changed: boolean;      // 変更有無
  manualReview: string[]; // 手動確認が必要な箇所（"path:line — 理由" 形式）
}
```

---

## ast-grep ルール (`rules/*.yml`) との関係

`rules/` 配下の YAML ファイルは ast-grep によるパターン検索用ルールです。  
実際の変換ロジックとは独立しており、変換前の確認・影響範囲調査に使います。

```bash
# 例: insensitive-mode パターンにマッチするファイルを検索
ast-grep scan --rule scripts/codemods/rules/insensitive-mode.yml .
```

---

## 新規コードモッドの追加手順

### 1. 変換スクリプトを作成する

`scripts/codemods/<name>.ts` を作成する。雛形:

```ts
/**
 * <name>
 *
 * <1行: このコードモッドが何を変換するか>
 * <1行: 対象外のパターン（手動確認へ委ねるケース）>
 */

import { join } from 'path';
import { ensureImport, runCodemod, TransformInput, TransformResult } from './lib/codemod-runner';

/**
 * Transform callback: apply to a single file's content.
 *
 * @param input - File path and current content / ファイルパスと現在の内容
 * @returns Transform result / 変換結果
 */
export function transformMyCodemod({ filePath, content }: TransformInput): TransformResult {
  const manualReview: string[] = [];

  // スキップ条件
  if (filePath.endsWith('some-excluded-file.ts')) {
    return { newContent: content, changed: false, manualReview: [] };
  }

  let newContent = content;
  let changed = false;

  // 変換ロジック
  // ...

  return { newContent, changed, manualReview };
}

// スクリプトとして直接実行された場合のエントリポイント
runCodemod(transformMyCodemod, {
  roots: [join(__dirname, '../../')],
  label: '<name>',
  write: process.argv.includes('--write'),
});
```

### 2. テストを追加する

`scripts/codemods/__tests__/codemod-runner.test.ts` に `describe('transformMyCodemod', ...)` ブロックを追加する。  
ポイント:
- `tmpDir` は `beforeEach` で初期化済み。`write()` ヘルパーで一時ファイルを生成する
- dry-run（`write: false`）の統合テストを必ず含める
- `changed: true` / `changed: false` の両方をカバーする
- `manualReview` が期待通りに埋まることを確認する

### 3. `package.json` に npm script を追加する

```json
"scripts": {
  "codemod:<name>": "bun run scripts/codemods/<name>.ts"
}
```

`codemod:all` にも連結する場合は既存の連結コマンドに `&& bun run scripts/codemods/<name>.ts` を追記する。

### 4. CI ゲートに登録する（通常は不要）

コードモッドのテストはすでに `scripts/codemods/__tests__/codemod-runner.test.ts` として CI ゲートに登録済みのため、  
既存ファイルにテストを追加するだけで CI に自動で含まれる。  
別ファイルを分けた場合のみ `scripts/ci-gate-tests.txt` に追記する。

---

## 設計上の注意

- **冪等性**: 変換は何度適用しても結果が変わらないこと。2 回目の実行で `changed: false` になること。
- **dry-run デフォルト**: `write: false`（dry-run）がデフォルト。本番適用は `--write` フラグを明示的に渡す。
- **manualReview**: 自動変換が安全でないケース（複数箇所参照・型アノテーションあり・eslint-disable コメントあり）は変更せず `manualReview` に追記する。
- **スキップ条件**: 変換対象ファイル自体（例: `config/db-provider.ts`）を変換しないよう `filePath` でガードする。
