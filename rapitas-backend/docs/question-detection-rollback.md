# AIエージェント質問判定機能 - ロールバック手順書

## 概要

キーベース判定方式への移行で問題が発生した場合のロールバック手順を説明します。

## ロールバック判断基準

以下のいずれかに該当する場合、ロールバックを検討してください:

- 質問検出が全く機能しない
- アプリケーションがクラッシュする
- 既存のワークフローが破壊される
- パフォーマンスが著しく低下する

## ロールバック手順

### Step 1: バックアップの確認

変更前のファイルがGitで管理されていることを確認:

```bash
git log --oneline -5  # 最近のコミットを確認
git diff HEAD~1 -- services/agents/  # 変更内容を確認
```

### Step 2: コードのロールバック

#### 方法A: Git revert（推奨）

```bash
# 移行コミットを特定
git log --oneline | grep -i "question"

# コミットをrevert
git revert <commit-hash>
```

#### 方法B: ファイル単位でのロールバック

```bash
# 特定のファイルを前のバージョンに戻す
git checkout HEAD~1 -- services/agents/claude-code-agent.ts
git checkout HEAD~1 -- services/agents/base-agent.ts
git checkout HEAD~1 -- services/agents/agent-orchestrator.ts
```

### Step 3: 新規ファイルの削除（オプション）

新規作成されたファイルを削除:

```bash
rm services/agents/question-detection.ts
rm docs/question-detection-migration.md
rm docs/question-detection-rollback.md
```

### Step 4: テストファイルのロールバック

```bash
git checkout HEAD~1 -- tests/question-detection.test.ts
```

### Step 5: ビルドと確認

```bash
cd rapitas-backend
bun run build
bun test
```

### Step 6: サービスの再起動

```bash
# 開発環境
bun run dev

# 本番環境
pm2 restart rapitas-backend
```

## 部分的ロールバック

### questionKey機能のみ無効化

`questionKey`フィールドのみを削除し、他の変更は維持する場合:

1. `base-agent.ts`から`questionKey`フィールドを削除:

```typescript
// AgentExecutionResult から questionKey を削除
export type AgentExecutionResult = {
  // ... existing fields ...
  // questionKey?: QuestionKey;  // コメントアウトまたは削除
};
```

2. `claude-code-agent.ts`から`questionKey`の設定を削除:

```typescript
// resolve() から questionKey を削除
resolve({
  success: true,
  output: this.outputBuffer,
  // ... other fields ...
  // questionKey,  // コメントアウトまたは削除
});
```

3. `agent-orchestrator.ts`のイベント発火から`questionKey`を削除:

```typescript
// emitEvent の data から questionKey を削除
data: {
  output: result.output,
  waitingForInput: true,
  question: result.question,
  questionType: result.questionType,
  questionDetails: result.questionDetails,
  // questionKey: result.questionKey,  // コメントアウトまたは削除
},
```

## DBスキーマのロールバック（該当する場合）

`questionKey`カラムがDBに追加された場合:

```bash
# マイグレーションのロールバック
bunx prisma migrate reset --skip-seed

# または特定のマイグレーションを手動でロールバック
bunx prisma db execute --file ./prisma/migrations/<migration_name>/down.sql
```

## 検証チェックリスト

ロールバック後、以下を確認:

- [ ] アプリケーションが正常に起動する
- [ ] 質問検出が動作する（既存方式）
- [ ] 既存のAPIレスポンス形式が正しい
- [ ] フロントエンドが正常に動作する
- [ ] テストが全てパスする

## 緊急連絡先

問題が解決しない場合は、以下を確認:

1. エラーログの確認: `bun run logs` または `pm2 logs`
2. GitHubのIssueを確認・作成

## 予防策

今後の移行作業では:

1. ステージング環境で十分なテストを実施
2. フィーチャーフラグを使用した段階的リリース
3. 監視とアラートの設定
4. ロールバック手順の事前確認
