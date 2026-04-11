/**
 * PromptBuilder
 *
 * Builds the text prompt sent to the Claude CLI for a sub-agent task.
 * Uses the optimized prompt when available; otherwise assembles a structured
 * prompt from task metadata and related knowledge from agent memory.
 */
import { findRelatedKnowledge } from '../../memory/task-knowledge-extractor';
import { createLogger } from '../../../config/logger';
import type { AgentTask } from '../../agents/base-agent';

const logger = createLogger('sub-agent-controller:prompt-builder');

/**
 * Build the prompt string to send to the Claude CLI subprocess.
 *
 * @param agentId - Agent identifier for log context / ログ用エージェントID
 * @param task - Task definition / タスク定義
 * @returns Prompt string to write to CLI stdin / CLIのstdinに書き込むプロンプト文字列
 */
export async function buildPrompt(agentId: string, task: AgentTask): Promise<string> {
  if (task.optimizedPrompt) {
    logger.info(
      `[SubAgent ${agentId}] Using optimized prompt (${task.optimizedPrompt.length} chars)`,
    );
    return task.optimizedPrompt;
  }

  const sections: string[] = [];

  sections.push('# タスク実行指示');
  sections.push('');

  if (task.title) {
    sections.push(`## タスク: ${task.title}`);
    sections.push('');
  }

  if (task.description) {
    sections.push('## 詳細');
    sections.push(task.description);
    sections.push('');
  }

  // AIAnalysis results
  if (task.analysisInfo) {
    const analysis = task.analysisInfo;

    sections.push('## 実装情報');
    if (analysis.summary) {
      sections.push(`- **サマリー:** ${analysis.summary}`);
    }
    if (analysis.complexity) {
      const complexityLabels: Record<string, string> = {
        simple: 'シンプル',
        medium: '中程度',
        complex: '複雑',
      };
      sections.push(
        `- **複雑度:** ${complexityLabels[analysis.complexity] || analysis.complexity}`,
      );
    }
    if (analysis.estimatedTotalHours) {
      sections.push(`- **推定時間:** ${analysis.estimatedTotalHours}時間`);
    }
    sections.push('');

    if (analysis.tips && analysis.tips.length > 0) {
      sections.push('## 実装のヒント');
      for (const tip of analysis.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push('');
    }

    if (analysis.reasoning) {
      sections.push('## 実装方針');
      sections.push(analysis.reasoning);
      sections.push('');
    }
  }

  // NOTE: Inject related knowledge from agent memory to avoid repeating past mistakes
  try {
    const knowledge = await findRelatedKnowledge(task.title, task.description, task.themeId, 3);
    if (knowledge.length > 0) {
      sections.push('## 過去の知見（エージェントメモリ）');
      for (const entry of knowledge) {
        // NOTE: Flag cross-project knowledge so the agent knows it came from a different context
        const crossLabel = (entry as Record<string, unknown>).isCrossProject
          ? ' 🔗(別プロジェクト)'
          : '';
        sections.push(`- **${entry.title}**${crossLabel}: ${entry.content.slice(0, 200)}`);
      }
      sections.push('');
    }
  } catch {
    // NOTE: Knowledge retrieval failure should not block execution
  }

  sections.push('## 実行指示');
  sections.push('上記のタスクを実装してください。');
  sections.push('不明点がある場合は、AskUserQuestionで質問してください。');
  sections.push(
    '質問時は必ず選択肢（options配列）を提供してください（2-4個）。フリーテキスト入力はAPIキーやパスなどの場合のみ許可。',
  );
  sections.push('');

  sections.push('## 注意事項');
  sections.push('このタスクは他のタスクと並列で実行されている可能性があります。');
  sections.push('- このタスクは専用のgit worktreeで実行されています。git操作は安全に行えます。');
  sections.push('- 作業完了後は変更をコミットし、リモートにプッシュしてください。');
  sections.push('- 進捗状況を明確にOutputすること');

  return sections.join('\n');
}
