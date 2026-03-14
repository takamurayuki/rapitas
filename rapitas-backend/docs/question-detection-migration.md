# AIエージェント質問判定機能 - キーベース判定方式への移行ガイド

## 概要

このドキュメントでは、AIエージェントの質問判定ロジックを「パターンマッチング方式」から「キーベース判定方式」へ移行する手順を説明します。

## 変更内容

### 1. 新規作成ファイル

| ファイル | 説明 |
|---------|------|
| `services/agents/question-detection.ts` | キーベース判定システムの中核モジュール |

### 2. 変更ファイル

| ファイル | 変更内容 |
|---------|----------|
| `services/agents/base-agent.ts` | 新しい型定義のre-export、`AgentExecutionResult`に`questionKey`フィールド追加 |
| `services/agents/claude-code-agent.ts` | 新しいキー判定システムの使用 |
| `services/agents/agent-orchestrator.ts` | イベント発火時に`questionKey`を含める |
| `tests/question-detection.test.ts` | 新しいキーベース判定システムのテスト |

## 新しいキー構造

```typescript
type QuestionKey = {
  status: "awaiting_user_input" | "processing" | "completed";
  question_id: string;  // 一意識別子（例: "q_m5k2x9_abc123"）
  question_type: "clarification" | "confirmation" | "selection";
  requires_response: boolean;
  timeout_seconds?: number;
};
```

## 移行手順

### Phase 1: 準備（完了済み）

1. ✅ 現状コードの分析
2. ✅ 新しいキーベース判定システムの設計
3. ✅ 型定義の作成

### Phase 2: 実装（完了済み）

1. ✅ `question-detection.ts`の作成
2. ✅ `base-agent.ts`の更新
3. ✅ `claude-code-agent.ts`の更新
4. ✅ `agent-orchestrator.ts`の更新

### Phase 3: テスト

1. 単体テストの実行:
   ```bash
   cd rapitas-backend
   bun test tests/question-detection.test.ts
   ```

2. 統合テスト:
   - 開発者モードでタスクを実行
   - AskUserQuestionツールが呼び出されることを確認
   - `questionKey`がレスポンスに含まれることを確認

### Phase 4: 本番デプロイ

1. バックエンドのビルド:
   ```bash
   cd rapitas-backend
   bun run build
   ```

2. サービスの再起動

### Phase 5: DBスキーマ更新（オプション・将来）

`questionKey`をDBに永続化する場合は、Prismaスキーマを更新:

```prisma
model AgentExecution {
  // ... existing fields ...
  questionKey       Json?     // 構造化キー情報
}
```

マイグレーション:
```bash
bunx prisma migrate dev --name add_question_key
```

## 後方互換性

以下の措置により、既存のAPIとの互換性を維持しています:

1. **既存の型**: `QuestionType`（`'tool_call' | 'none'`）は引き続きサポート
2. **レスポンス形式**: 既存の`question`, `questionType`, `questionDetails`フィールドはそのまま維持
3. **新しいフィールド**: `questionKey`は追加フィールドとして含まれる（オプショナル）

## 検証チェックリスト

- [ ] 質問検出が正常に動作する
- [ ] `questionKey`がレスポンスに含まれる
- [ ] 既存の`questionType`フィールドが正しい値を返す
- [ ] `questionDetails`（選択肢など）が正しく抽出される
- [ ] フロントエンドで質問UIが正しく表示される
- [ ] 質問への回答が正常に処理される

## トラブルシューティング

### 質問が検出されない

1. Claude Codeの出力形式を確認（stream-json形式である必要あり）
2. `AskUserQuestion`ツール呼び出しがあるか確認
3. ログを確認: `[Claude Code] AskUserQuestion tool detected!`

### questionKeyがundefined

1. `detectQuestionFromToolCall`が正しく呼び出されているか確認
2. ツール名が`AskUserQuestion`であることを確認

### 型エラー

1. `base-agent.ts`のre-exportが正しいか確認
2. `question-detection.ts`が正しくインポートされているか確認
