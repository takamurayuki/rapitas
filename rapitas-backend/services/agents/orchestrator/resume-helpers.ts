/**
 * Resume Helpers
 *
 * Utility functions for building resume prompts and resolving agent configurations
 * from the database. Used exclusively by execution-resume.ts.
 */

import { agentFactory } from '../agent-factory';
import type { AgentConfigInput, AgentType } from '../agent-factory';
import { decrypt } from '../../../utils/encryption';
import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';

const logger = createLogger('resume-helpers');

/**
 * Builds a resume prompt with context from the previous execution.
 *
 * @param task - Task record / タスクレコード
 * @param lastOutput - Tail of previous output / 前回出力の末尾
 * @param logSummary - Recent log entries / 最近のログエントリ
 * @param errorMessage - Interruption reason if any / 中断理由
 * @returns Formatted prompt string / フォーマット済みプロンプト
 */
export function buildResumePrompt(
  task: { title: string; description: string | null },
  lastOutput: string,
  logSummary: string,
  errorMessage: string | null,
): string {
  let prompt = `# 作業再開

このタスクは以前のセッションで中断されました。作業を途中から再開してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || 'なし'}

## 前回の作業状況
以下は中断前の出力の最後の部分です：

\`\`\`
${lastOutput}
\`\`\`
`;

  if (errorMessage) {
    prompt += `
## 中断理由
${errorMessage}
`;
  }

  prompt += `
## 指示
上記の情報を基に、中断されたタスクを続行してください。
- 既に完了した作業は繰り返さないでください
- 中断された地点から作業を再開してください
- 不明な点があれば質問してください
`;

  return prompt;
}

/**
 * Resolves agent configuration from the database, decrypting the API key if present.
 * @returns Resolved AgentConfigInput, or fallback if DB record is missing / DB設定またはフォールバック
 */
export async function resolveAgentConfig(
  ctx: OrchestratorContext,
  agentConfigId: number,
  fallback: AgentConfigInput,
  claudeSessionId: string | null,
): Promise<AgentConfigInput> {
  const dbConfig = await ctx.prisma.aIAgentConfig.findUnique({
    where: { id: agentConfigId },
  });
  if (!dbConfig) {
    return fallback;
  }

  let decryptedApiKey: string | undefined;
  if (dbConfig.apiKeyEncrypted) {
    try {
      decryptedApiKey = decrypt(dbConfig.apiKeyEncrypted);
    } catch (e) {
      logger.error(
        { err: e, agentId: dbConfig.id },
        `[ResumeHelpers] Failed to decrypt API key for agent`,
      );
    }
  }

  return {
    type: (dbConfig.agentType as AgentType) || 'claude-code',
    name: dbConfig.name,
    endpoint: dbConfig.endpoint || undefined,
    apiKey: decryptedApiKey,
    modelId: dbConfig.modelId || undefined,
    workingDirectory: fallback.workingDirectory,
    timeout: fallback.timeout,
    dangerouslySkipPermissions: true,
    yoloMode: true,
    resumeSessionId: claudeSessionId || undefined,
    continueConversation: false,
  };
}
