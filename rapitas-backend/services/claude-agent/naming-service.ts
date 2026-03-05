import {
  sendAIMessage,
  type AIProvider,
  type AIMessage,
} from "../../utils/ai-client";

/**
 * タスク情報から意味のあるブランチ名を生成する
 */
export async function generateBranchName(
  taskTitle: string,
  taskDescription?: string | null,
  provider?: AIProvider,
  model?: string,
): Promise<{ branchName: string }> {
  const systemPrompt = `あなたはGitブランチ名を生成する専門家です。
タスクのタイトルと説明から、適切なGitブランチ名を生成してください。

ブランチ名のルール:
1. 英語で記述する
2. 小文字のケバブケース
3. 適切なプレフィックスを使用: feature/, fix/, refactor/, docs/, chore/
4. 50文字以内推奨
5. 特殊文字は使用しない

出力形式: ブランチ名のみを出力してください。`;

  const messages: AIMessage[] = [
    { role: "user", content: `タイトル: ${taskTitle}\n${taskDescription ? `説明: ${taskDescription}` : ""}\n\n上記のタスク情報から適切なGitブランチ名を生成してください。` },
  ];

  const response = await sendAIMessage({
    provider: provider || "claude",
    model,
    messages,
    systemPrompt,
    maxTokens: 100,
  });

  return { branchName: response.content.trim().replace(/^["']|["']$/g, "") };
}

/**
 * タスクの説明から簡潔なタイトルを自動生成する
 */
export async function generateTaskTitle(
  description: string,
  provider?: AIProvider,
  model?: string,
): Promise<{ title: string }> {
  const systemPrompt = `あなたはタスク管理のアシスタントです。
タスクの説明文から、簡潔で分かりやすいタスクタイトルを生成してください。

タイトルのルール:
1. 日本語で記述する
2. 30文字以内を推奨
3. 動詞を含めて何をするか明確にする
4. 余計な装飾や説明は不要

出力形式: タイトルのみを出力してください。`;

  const messages: AIMessage[] = [
    { role: "user", content: `以下のタスク説明から、簡潔なタイトルを生成してください:\n\n${description}` },
  ];

  const response = await sendAIMessage({
    provider: provider || "claude",
    model,
    messages,
    systemPrompt,
    maxTokens: 100,
  });

  return { title: response.content.trim().replace(/^["'「」『』]|["'「」『』]$/g, "") };
}
