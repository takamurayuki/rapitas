# コミット前チェックガイド

## 概要

コミット時にフォーマットやLintエラーが発生した場合、**自動的に修正を試み、成功すればコミットが継続されます**。修正できないエラーがある場合のみ、詳細なエラー情報が表示されます。

## 🚀 自動修正の仕組み

### コミット時の処理フロー

```bash
git commit -m "your message"
```

**自動実行される処理:**

1. **🔍 Step 1: 初回チェック**
   - lint-staged を実行（Prettier + ESLint）

2. **✅ 成功した場合**
   - そのままコミット完了

3. **⚠️ エラーが検出された場合**
   - 🔧 自動修正スクリプトを実行
     - フロントエンド: Prettier + ESLint --fix
     - バックエンド: Prettier
   - 📦 修正したファイルを再ステージング
4. **🔄 Step 2: 再検証**
   - 修正後に再度 lint-staged を実行
5. **✨ 結果**
   - 成功 → コミット継続
   - 失敗 → 詳細エラー表示 + コミット中断

### 実行例

```bash
$ git commit -m "feat: add new feature"

🔍 Pre-commit チェックを開始...

📋 Step 1: lint-staged を実行中...
⚠️  Lint/フォーマットエラーが検出されました

📝 8個のファイルを自動修正します...

🎨 フロントエンドファイルを修正中...
  ├─ Prettier実行...
  │  ✅ Prettier完了
  └─ ESLint --fix 実行...
     ✅ ESLint修正完了

📦 修正したファイルを再ステージング中...
✅ 再ステージング完了

🔄 Step 2: 修正後の検証を実行中...
✅ 自動修正が成功しました！
✨ コミットを継続します

[feature/new-feature abc1234] feat: add new feature
 8 files changed, 150 insertions(+), 42 deletions(-)
```

## 🛠️ 自動修正できないエラーの対処法

自動修正後もエラーが残る場合、**詳細なエラー情報が自動的に表示されます**：

```bash
═══════════════════════════════════════════
❌ 自動修正後もエラーが残っています
═══════════════════════════════════════════

🔍 詳細なエラー情報を表示中...

🎨 フロントエンドファイルをチェック中...
  └─ ESLintチェック...
     ❌ ESLintエラーが見つかりました:

     📄 src/components/TaskCard.tsx
        ⚠️  Line 58:9 - 'dateLocale' is assigned a value but never used
        ❌ Line 99:9 - 'rollbackSubtaskStatus' is assigned a value but never used

💡 対処方法:
   1. 上記のエラーを手動で修正
   2. git add . で再ステージング
   3. git commit で再度コミット

   または、エラーを無視してコミット:
   git commit --no-verify
```

### 1. 詳細なエラーを確認

エラーは **自動的に表示されます**。手動で確認したい場合：

```bash
npm run check:commit
```

### 2. 手動で修正

エラー内容を確認して、手動で修正します：

```bash
# 該当ファイルを編集
code src/components/TaskCard.tsx

# 未使用変数を削除、または使用する
# React Hook依存配列を修正
```

### 3. 再度コミット

```bash
git add .
git commit -m "your message"
# 自動修正が再度実行されます
```

### 4. エラーを無視してコミット（非推奨）

どうしても必要な場合のみ：

```bash
git commit -m "your message" --no-verify
```

## 📋 手動コマンド

自動修正を手動で実行したい場合：

## 📋 手動コマンド

自動修正を手動で実行したい場合：

```bash
# 全ファイルの自動修正
npm run lint:fix

# 詳細チェック（エラー箇所を明確に表示）
npm run check:commit

# コミット（自動修正付き）
git commit -m "your message"

# 自動修正をスキップしてコミット
git commit -m "your message" --no-verify
```

### Prettierエラー

**エラー:**

```
Checking formatting...
[warn] src/components/Example.tsx
```

**修正方法:**

```bash
cd rapitas-frontend
npx prettier --write src/components/Example.tsx
```

### ESLint警告: 未使用変数

**エラー:**

```
'variableName' is assigned a value but never used
```

**修正方法:**

1. 変数を削除する
2. 変数名を `_variableName` に変更（意図的に未使用であることを示す）
3. 使用する

### ESLint警告: React Hook依存配列

**エラー:**

```
React Hook useEffect has missing dependencies
```

**修正方法:**

1. 依存配列に必要な値を追加
2. `useCallback` や `useMemo` でラップ
3. eslint-disableコメントを追加（非推奨）

## コマンド一覧

| コマンド                               | 説明                             |
| -------------------------------------- | -------------------------------- |
| `npm run check:commit`                 | コミット前の詳細チェック（手動） |
| `npm run lint:fix`                     | 自動修正可能なエラーを修正       |
| `npm run lint:all`                     | 全ファイルのLintチェック         |
| `cd rapitas-frontend && pnpm run lint` | フロントエンドのみLint           |
| `cd rapitas-backend && bun run lint`   | バックエンドのみLint             |

## ワークフロー推奨

### 基本フロー（自動修正あり）

1. コードを書く
2. `git add .` でステージング
3. `git commit -m "message"` でコミット
   - ✨ **自動的に修正が試みられます**
   - 成功すればそのままコミット完了
   - 失敗すれば詳細エラー表示

### エラーが出た場合

1. **エラーは自動的に表示されます** - どのファイルのどの行にエラーがあるか確認
2. 手動で修正
3. `git add .` で再ステージング
4. `git commit -m "message"` で再度コミット
   - 再度自動修正が試みられます

### 事前チェックしたい場合

1. コードを書く
2. `npm run lint:fix` で事前に自動修正
3. `git add .` でステージング
4. `git commit -m "message"` でコミット

## pre-commit フックの動作

`.husky/pre-commit` で自動実行されるフロー：

```bash
1. lint-staged を実行
   ├─ Prettier --write (フォーマット)
   └─ ESLint --fix (自動修正)

2. ❌ エラーが出た場合
   ├─ 自動修正スクリプトを実行
   ├─ 修正したファイルを再ステージング
   └─ 再度 lint-staged を実行

3. ✅ 成功 → コミット継続
   ❌ 失敗 → エラー表示 + 中断
```

## トラブルシューティング

### lint-stagedが終わらない

原因: ESLintのチェックに時間がかかっている可能性

対処:

```bash
# 一度中断してファイル数を減らす
git reset HEAD~1
git add <特定のファイル>
git commit
```

### エラーメッセージが表示されない

原因: lint-stagedの出力が省略されている

対処:

```bash
# 詳細チェックを手動実行
npm run check:commit
```

### Prettierとgitの改行コード問題

警告が表示される場合:

```
warning: in the working copy of 'file.ts', LF will be replaced by CRLF
```

これは警告のみで、コミットは可能です。`.gitattributes` で統一できます。
