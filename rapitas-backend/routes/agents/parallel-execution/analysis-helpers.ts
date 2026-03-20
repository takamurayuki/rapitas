/**
 * AnalysisHelpers
 *
 * Utility functions for dependency analysis: building analysis input from DB,
 * extracting file paths from text, and comparing plan vs verify content.
 * Does not define any route handlers.
 */
import { prisma } from '../../../config/database';
import type { DependencyAnalysisInput, TaskPriority } from '../../../services/parallel-execution';

/**
 * Build a DependencyAnalysisInput from a task and its subtasks.
 *
 * @param taskId - Task ID to analyze / 分析対象のタスクID
 * @returns DependencyAnalysisInput for the analyzer / アナライザー用の依存関係分析入力
 * @throws {Error} When the task is not found / タスクが見つからない場合
 */
export async function buildAnalysisInput(taskId: number): Promise<DependencyAnalysisInput> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      subtasks: {
        include: {
          prompts: true,
        },
      },
      prompts: true,
    },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const subtasks = task.subtasks.map((subtask: (typeof task.subtasks)[number]) => {
    const files: string[] = [];

    for (const prompt of subtask.prompts) {
      files.push(...extractFilePaths(prompt.optimizedPrompt));
      files.push(...extractFilePaths(prompt.originalDescription));
    }
    files.push(...extractFilePaths(subtask.description));

    return {
      id: subtask.id,
      title: subtask.title,
      description: subtask.description || undefined,
      priority: (subtask.priority || 'medium') as TaskPriority,
      estimatedHours: subtask.estimatedHours || 1,
      files: [...new Set(files)],
      // TODO: Load explicit dependencies from DB once the dependency table is implemented.
      explicitDependencies: [],
    };
  });

  return {
    parentTaskId: taskId,
    subtasks,
  };
}

/**
 * Extract file paths from text content.
 *
 * @param text - Source text to scan / スキャン対象のテキスト
 * @returns Array of unique file paths found / 検出されたユニークなファイルパスの配列
 */
export function extractFilePaths(text: string | null | undefined): string[] {
  if (!text) return [];

  const patterns = [
    /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

/**
 * Compare plan.md and verify.md to detect deviations.
 *
 * @param planContent - Contents of plan.md / plan.mdの内容
 * @param verifyContent - Contents of verify.md / verify.mdの内容
 * @returns Deviation summary string, or null if none / 逸脱サマリー文字列
 */
export function analyzePlanDeviation(planContent: string, verifyContent: string): string | null {
  const planChecklist = planContent.match(/- \[[ xX]\].+/g) || [];
  const planFiles = extractMentionedFiles(planContent);
  const verifyFiles = extractMentionedFiles(verifyContent);

  const addedFiles = verifyFiles.filter((f) => !planFiles.includes(f));
  const removedFiles = planFiles.filter((f) => !verifyFiles.includes(f));

  const lines: string[] = [];
  if (addedFiles.length > 0) lines.push(`**Plan外の変更ファイル**: ${addedFiles.join(', ')}`);
  if (removedFiles.length > 0)
    lines.push(`**Planにあるが未変更のファイル**: ${removedFiles.join(', ')}`);

  const verifyChecklist = verifyContent.match(/- \[[ xX]\].+/g) || [];
  const completedCount = verifyChecklist.filter((item) => /\[[xX]\]/.test(item)).length;
  const totalPlanned = planChecklist.length;

  if (totalPlanned > 0) {
    const rate = Math.round((completedCount / totalPlanned) * 100);
    lines.push(`**Plan達成率**: ${completedCount}/${totalPlanned} (${rate}%)`);
  }

  if (lines.length <= 1 && addedFiles.length === 0 && removedFiles.length === 0) {
    lines.unshift('Planからの大きな逸脱はありません。');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract file references mentioned in markdown content.
 *
 * @param content - Markdown content to scan / スキャン対象のMarkdown
 * @returns Unique file paths with path separators / パスセパレータ付きユニークファイルパス
 */
export function extractMentionedFiles(content: string): string[] {
  const matches = content.match(/[\w\-./]+\.[a-zA-Z]{1,10}/g) || [];
  return [...new Set(matches.filter((m) => m.includes('/') && !m.match(/^v?\d+\.\d+/)))];
}
