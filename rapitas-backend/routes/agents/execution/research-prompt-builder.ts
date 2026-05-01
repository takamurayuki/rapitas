/**
 * research-prompt-builder
 *
 * Builds the strict research-only prompt that gets sent to codex via STDIN
 * (a short imperative goes via positional argv; this body goes via stdin).
 *
 * Design principle: do NOT instruct the agent to save files. The CLI runs
 * with `--sandbox=read-only` and the parent process (Rapitas) captures
 * stdout to write the markdown file itself. codex never gets file-write
 * permission for any path.
 */

/**
 * Build a research-only prompt for codex / claude-code / gemini.
 * Shorter and more imperative than the previous version: the agent has
 * a very short positional headline + this body on stdin, so we don't need
 * to repeat "this is research mode" multiple times.
 *
 * @param taskTitle - Task title / タスクタイトル
 * @param taskDescription - Task description / タスク詳細
 * @param worktreePath - Working directory the agent should investigate
 * @returns Prompt body (intended to be piped over stdin)
 */
export function buildResearchPrompt(
  taskTitle: string,
  taskDescription: string,
  worktreePath: string,
): string {
  return `# 調査タスク

次の不具合・改善要件について、リポジトリ内の既存実装を読み取り、Markdown の調査レポートを出力してください。

## タスク
- **タイトル**: ${taskTitle}
${taskDescription ? `- **詳細**: ${taskDescription}` : ''}

## 作業ディレクトリ
\`${worktreePath}\`

## 必ず調査すること
- タスクのキーワードに関連する page / component / hook / test
- 関連シンボル・状態管理・永続化箇所 (例: \`localStorage\`, \`useState\`, store)
- ルーティング / API endpoint / DB schema (該当する場合)
- 関連ファイルパスを **3 件以上** 具体的に列挙する

## 禁止 (sandbox で物理的にブロックされています)
- ファイル変更 / コード編集
- \`git\` 操作
- \`pnpm\` / \`vitest\` / \`tsc\` / \`prettier\` / \`eslint\` 等の実行

## 最終出力 (必ず守ってください)
- **\`# 調査レポート\` の見出しから開始すること**
- 800 文字以上の実質的な内容
- 前置き・確認・モード宣言は禁止 (例: 「了解しました」「調査専用モードで...」「確認します」)
- 以下のセクションをすべて含めること:

\`\`\`markdown
# 調査レポート

## タスク概要
[2-3 行]

## 既存機能チェック
- 既存実装の有無
- **関連ファイルパス** (3 件以上、Read/Grep で確認した実在パス):
  - \`path/to/file1.tsx\` — 何を担当しているか
  - \`path/to/file2.ts\` — 何を担当しているか
  - \`path/to/file3.test.tsx\` — 何を担当しているか
- 現状の振る舞い

## 影響範囲
- 変更が必要そうなファイル
- 依存関係 / 影響を受けるコンポーネント

## 実装方針
### 選択肢A: [タイトル]
- 説明 (根拠ファイル: \`path:line\`)
- メリット / デメリット

### 選択肢B: [タイトル]
- 説明 / メリット / デメリット

### 推奨
**選択肢 [A/B] を推奨**。理由: ...

## リスク
- 破壊的変更 / 互換性 / マイグレーション

## テスト戦略
- ユニットテストのケース
- 統合テストのシナリオ

## 未確定事項 (計画フェーズで解決)
- [ ] ...
\`\`\`
`;
}
