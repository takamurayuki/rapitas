/**
 * CodexCliAgent — Prompt Builder
 *
 * Builds structured prompts from AgentTask objects for Codex CLI execution.
 * Not responsible for process management or output parsing.
 */

import type { AgentTask } from '../base-agent';
import { createLogger } from '../../../config/logger';

const logger = createLogger('codex-cli-agent/prompt-builder');

/**
 * Build a structured prompt string from a task, incorporating analysis info when available.
 * Returns the task's optimized prompt directly if one is provided.
 *
 * @param task - The agent task to build a prompt for / プロンプトを生成するエージェントタスク
 * @param logPrefix - Log prefix for context-specific logging / ログ出力用のプレフィックス
 * @returns Prompt string for Codex CLI / Codex CLI 向けのプロンプト文字列
 */
export function buildStructuredPrompt(task: AgentTask, logPrefix: string): string {
  if (task.optimizedPrompt) {
    logger.info(`${logPrefix} Using optimized prompt (${task.optimizedPrompt.length} chars)`);
    return task.optimizedPrompt;
  }

  const analysis = task.analysisInfo;

  if (!analysis) {
    return task.description || task.title;
  }

  const priorityLabels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    urgent: '緊急',
  };

  const complexityLabels: Record<string, string> = {
    simple: 'シンプル',
    medium: '中程度',
    complex: '複雑',
  };

  const sections: string[] = [];

  sections.push('# タスク実装指示');
  sections.push('');
  sections.push('## 概要');
  sections.push(`**タスク名:** ${task.title}`);
  sections.push(`**分析サマリー:** ${analysis.summary}`);
  sections.push(`**複雑度:** ${complexityLabels[analysis.complexity] || analysis.complexity}`);
  sections.push(`**推定総時間:** ${analysis.estimatedTotalHours}時間`);
  sections.push('');

  if (task.description) {
    sections.push('## タスク詳細');
    sections.push(task.description);
    sections.push('');
  }

  if (analysis.subtasks && analysis.subtasks.length > 0) {
    sections.push('## 実装手順');
    sections.push('以下の順序でタスクを実装してください：');
    sections.push('');

    const sortedSubtasks = [...analysis.subtasks].sort((a, b) => a.order - b.order);

    for (const subtask of sortedSubtasks) {
      const priorityLabel = priorityLabels[subtask.priority] || subtask.priority;
      sections.push(`### ${subtask.order}. ${subtask.title}`);
      sections.push(`- **説明:** ${subtask.description}`);
      sections.push(`- **推定時間:** ${subtask.estimatedHours}時間`);
      sections.push(`- **優先度:** ${priorityLabel}`);

      if (subtask.dependencies && subtask.dependencies.length > 0) {
        const depTitles = subtask.dependencies
          .map((depOrder) => {
            const dep = analysis.subtasks.find((s) => s.order === depOrder);
            return dep ? `${depOrder}. ${dep.title}` : `ステップ${depOrder}`;
          })
          .join(', ');
        sections.push(`- **依存:** ${depTitles} の完了後に実行`);
      }
      sections.push('');
    }
  }

  if (analysis.reasoning) {
    sections.push('## 実装方針の根拠');
    sections.push(analysis.reasoning);
    sections.push('');
  }

  if (analysis.tips && analysis.tips.length > 0) {
    sections.push('## 実装のヒント');
    for (const tip of analysis.tips) {
      sections.push(`- ${tip}`);
    }
    sections.push('');
  }

  sections.push('## 実行指示');
  sections.push('上記の手順に従って、タスクを最初から最後まで実装してください。');
  sections.push('各ステップの完了後、次のステップに進んでください。');
  sections.push('不明点がある場合は、質問してください。');

  return sections.join('\n');
}
