/**
 * CliUtils
 *
 * CLI path resolution and prompt construction utilities for the Claude Code provider.
 * Does NOT start processes or handle streaming.
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { AgentTaskDefinition } from '../abstraction/types';

/**
 * Resolves the absolute path of a CLI command on Windows using `where`.
 * Falls back to the original path on any error.
 *
 * @param cliName - CLI command name or path / CLIコマンド名またはパス
 * @returns Absolute path string on Windows, original string on other platforms / Windowsでのフルパスまたはそのままのパス
 */
export function resolveCliPath(cliName: string): string {
  if (process.platform !== 'win32') return cliName;
  try {
    const resolved = execSync(`where ${cliName}`, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Fallback to original path
  }
  return cliName;
}

/**
 * Builds the final prompt string from a task definition.
 * Prefers optimizedPrompt, then structured analysis, then plain description.
 *
 * @param task - Agent task definition / エージェントタスク定義
 * @returns Prompt string to send to Claude Code / Claude Codeに送るプロンプト文字列
 */
export function buildPrompt(task: AgentTaskDefinition): string {
  if (task.optimizedPrompt) {
    return task.optimizedPrompt;
  }

  if (task.analysis) {
    return buildStructuredPrompt(task);
  }

  return task.prompt || task.description || task.title;
}

/**
 * Builds a structured markdown prompt from task analysis metadata.
 *
 * @param task - Task definition with populated analysis field / analysisフィールドが設定されたタスク定義
 * @returns Structured markdown string / 構造化されたmarkdown文字列
 */
export function buildStructuredPrompt(task: AgentTaskDefinition): string {
  const analysis = task.analysis!;
  const sections: string[] = [];

  sections.push('# タスク実装指示');
  sections.push('');
  sections.push('## 概要');
  sections.push(`**タスク名:** ${task.title}`);
  sections.push(`**分析サマリー:** ${analysis.summary}`);
  sections.push(`**複雑度:** ${analysis.complexity}`);
  if (analysis.estimatedDuration) {
    sections.push(`**推定時間:** ${analysis.estimatedDuration}分`);
  }
  sections.push('');

  if (task.description) {
    sections.push('## タスク詳細');
    sections.push(task.description);
    sections.push('');
  }

  if (analysis.subtasks && analysis.subtasks.length > 0) {
    sections.push('## 実装手順');
    for (const subtask of analysis.subtasks) {
      sections.push(`### ${subtask.order}. ${subtask.title}`);
      sections.push(`- **説明:** ${subtask.description}`);
      if (subtask.estimatedDuration) {
        sections.push(`- **推定時間:** ${subtask.estimatedDuration}分`);
      }
      sections.push(`- **優先度:** ${subtask.priority}`);
      sections.push('');
    }
  }

  if (analysis.tips && analysis.tips.length > 0) {
    sections.push('## 実装のヒント');
    for (const tip of analysis.tips) {
      sections.push(`- ${tip}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
