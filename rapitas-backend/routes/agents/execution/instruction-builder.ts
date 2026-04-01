/**
 * execution/instruction-builder
 *
 * Builds the full instruction string sent to the agent worker by combining
 * the task description, an optional optimized prompt, attachment metadata,
 * and a previously computed task analysis result.
 * Separated from execute-route.ts to keep it under 300 lines.
 */

import { join } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { fromJsonString } from '../../../utils/database/db-helpers';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const log = createLogger('routes:agent-execution:instruction-builder');

/** Structured analysis output produced by a prior analysis agent action. */
export interface AnalysisInfo {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedTotalHours: number;
  subtasks: Array<{
    title: string;
    description: string;
    estimatedHours: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    order: number;
    dependencies?: number[];
  }>;
  reasoning: string;
  tips?: string[];
}

/** Attachment descriptor passed in the execute request body. */
export interface AttachmentDescriptor {
  id: number;
  title: string;
  type: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  description?: string;
}

/**
 * Builds the full instruction string for the agent worker.
 *
 * @param params.taskTitle - Task title / タスクタイトル
 * @param params.taskDescription - Task description / タスク説明
 * @param params.instruction - Additional user instruction / 追加指示
 * @param params.optimizedPrompt - Optional AI-optimized prompt / 最適化プロンプト
 * @param params.attachments - File attachments to reference / 添付ファイル一覧
 * @returns Full instruction string / エージェントへの完全指示文字列
 */
export function buildFullInstruction(params: {
  taskTitle: string;
  taskDescription?: string | null;
  instruction?: string;
  optimizedPrompt?: string;
  attachments?: AttachmentDescriptor[];
  /** Target working directory for implementation / 実装先の作業ディレクトリ */
  workingDirectory?: string;
}): string {
  const { taskTitle, taskDescription, instruction, optimizedPrompt, attachments, workingDirectory } = params;

  let fullInstruction: string;
  if (optimizedPrompt) {
    fullInstruction = instruction
      ? `${optimizedPrompt}\n\nAdditional instructions:\n${instruction}`
      : optimizedPrompt;
  } else {
    fullInstruction = instruction
      ? `${taskDescription || taskTitle}\n\nAdditional instructions:\n${instruction}`
      : taskDescription || taskTitle;
  }

  // NOTE: Explicitly tell the agent where to work so it doesn't default to rapitas project.
  if (workingDirectory) {
    fullInstruction += `\n\n## 作業ディレクトリ (Working Directory)\n`;
    fullInstruction += `このタスクは以下のディレクトリで実行してください:\n`;
    fullInstruction += `**${workingDirectory}**\n\n`;
    fullInstruction += `重要: あなたのカレントディレクトリはこのディレクトリに設定されています。`;
    fullInstruction += `rapitasプロジェクト(C:\\Projects\\rapitas)のファイルを変更しないでください。`;
    fullInstruction += `すべてのファイル操作は上記ディレクトリ内で行ってください。\n`;
  }

  if (attachments && attachments.length > 0) {
    const attachmentInfo = attachments
      .map((a) => {
        let info = `- ${a.title} (${a.type})`;
        if (a.fileName) info += ` - File name: ${a.fileName}`;
        if (a.description) info += ` - Description: ${a.description}`;
        if (a.filePath) info += `\n  Path: ${join(UPLOAD_DIR, a.filePath)}`;
        return info;
      })
      .join('\n');
    fullInstruction += `\n\n## Attached Files\nThe following files are attached to this task. Please refer to them as needed:\n${attachmentInfo}`;
  }

  return fullInstruction;
}

/**
 * Fetches and parses the most recent successful analysis action for a config.
 * Returns undefined if none exists or if parsing fails.
 *
 * @param configId - DeveloperModeConfig ID to search within / 設定ID
 * @returns Parsed AnalysisInfo or undefined / 解析済みAnalysisInfoまたはundefined
 */
export async function fetchAnalysisInfo(configId: number): Promise<AnalysisInfo | undefined> {
  try {
    const latestAnalysisAction = await prisma.agentAction.findFirst({
      where: {
        session: { configId },
        actionType: 'analysis',
        status: 'success',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestAnalysisAction?.output) return undefined;

    try {
      const analysisOutput = fromJsonString<Record<string, unknown>>(latestAnalysisAction.output);
      if (!analysisOutput?.summary || !analysisOutput?.suggestedSubtasks) return undefined;

      return {
        summary: analysisOutput.summary as string,
        complexity:
          (analysisOutput.complexity as 'simple' | 'medium' | 'complex') || 'medium',
        estimatedTotalHours: (analysisOutput.estimatedTotalHours as number) || 0,
        subtasks: (
          (analysisOutput.suggestedSubtasks as Array<{
            title: string;
            description?: string;
            estimatedHours?: number;
            priority?: string;
            order?: number;
            dependencies?: number[];
          }>) || []
        ).map((st) => ({
          title: st.title,
          description: st.description || '',
          estimatedHours: st.estimatedHours || 0,
          priority: (st.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
          order: st.order || 0,
          dependencies: st.dependencies,
        })),
        reasoning: (analysisOutput.reasoning as string) || '',
        tips: analysisOutput.tips as string[] | undefined,
      };
    } catch (e) {
      log.error({ err: e }, `[instruction-builder] Failed to parse analysis result`);
      return undefined;
    }
  } catch (dbError) {
    log.error({ err: dbError }, `[instruction-builder] Failed to fetch analysis action`);
    return undefined;
  }
}
