/**
 * Workflow CLI Executor Prompt — Verifier Section
 *
 * Verifier/auto_verifier-only git operation constraints appended to the CLI
 * prompt by workflow-cli-executor-prompt.ts. Split out to keep the main
 * prompt builder under the file-size soft limit. This is the DECLARATIVE half
 * of the task 917 protection; the technical half (snapshot + restore) lives in
 * verify-phase-snapshot.ts and does not depend on the agent obeying this text.
 */

/**
 * Build the verifier-role git constraints section for one language.
 *
 * @param language - Output language / 出力言語
 * @returns Section text to append to the prompt / プロンプトへ追加するセクション
 */
export function buildVerifierRoleSection(language: 'ja' | 'en'): string {
  return language === 'ja'
    ? `\n\n## 検証フェーズの git 操作制限（厳守）
**あなたは「検証」エージェントです。** 今の作業ディレクトリはこのタスク専用の worktree で、実装担当の未コミット変更が含まれています。
- **禁止**: 既存のトラッキング済みファイルに対する \`git checkout -- <file>\` / \`git restore\` / \`git reset --hard\` / \`git clean -fd\` 等の破壊的操作。再現テストのために既存ファイルを一時的に書き換えて元に戻す運用も含めて禁止です — 実装担当の未コミット差分を巻き込んで消去する事故が過去に発生しています。
- **許可**: \`git status\` / \`git diff\` / \`git log\` 等の読み取り専用操作。
- **再現テストが必要な場合**: 既存ファイルを書き換えず、新規パス（未追跡ファイル）に一時テストを作成してください。`
    : `\n\n## Verify-phase git restrictions (strict)
**You are the VERIFIER.** Your working directory is a task-dedicated worktree that contains the implementer's uncommitted changes.
- **Forbidden**: destructive operations on existing tracked files — \`git checkout -- <file>\` / \`git restore\` / \`git reset --hard\` / \`git clean -fd\`. This includes temporarily editing an existing file for a reproduction test and reverting it — doing so has previously destroyed the implementer's uncommitted diff.
- **Allowed**: read-only operations — \`git status\` / \`git diff\` / \`git log\`.
- **For reproduction tests**: create a new (untracked) file instead of editing an existing one.`;
}
