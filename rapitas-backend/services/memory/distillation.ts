/**
 * 手続き知識蒸留（Distillation）
 * エージェント実行成功後に手続き知識を抽出してKnowledgeEntry作成
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { appendEvent } from './timeline';
import { createContentHash } from './utils';

const log = createLogger('memory:distillation');

/**
 * エージェント実行結果から手続き知識を蒸留
 */
export async function distillFromExecution(executionId: number): Promise<number | null> {
  const execution = await prisma.agentExecution.findUnique({
    where: { id: executionId },
    include: {
      session: {
        include: {
          config: {
            include: {
              task: { select: { id: true, title: true, description: true, themeId: true } },
            },
          },
        },
      },
      executionLogs: {
        orderBy: { sequenceNumber: 'asc' },
        take: 50, // 最新50チャンクのみ
      },
      gitCommits: true,
    },
  });

  if (!execution || execution.status !== 'completed') {
    log.debug({ executionId }, 'Execution not found or not completed, skipping distillation');
    return null;
  }

  const task = execution.session.config.task;
  if (!task) {
    log.debug({ executionId }, 'No task associated with execution');
    return null;
  }

  try {
    // ログとコミット情報を整理
    const logSummary = execution.executionLogs
      .map((l) => l.logChunk)
      .join('')
      .slice(0, 3000); // 最大3000文字

    const commitSummary = execution.gitCommits
      .map((c) => `- ${c.message} (${c.filesChanged} files, +${c.additions}/-${c.deletions})`)
      .join('\n');

    const response = await sendAIMessage({
      messages: [
        {
          role: 'user',
          content: `以下のエージェント実行結果から、再利用可能な手続き知識を抽出してください。

タスク: ${task.title}
説明: ${task.description ?? 'なし'}

実行出力（抜粋）:
${logSummary}

Gitコミット:
${commitSummary || 'なし'}

以下の形式で回答してください:
タイトル: [手続きの名前]
コンテキスト: [どのような状況で使えるか]
ステップ:
1. [手順1]
2. [手順2]
...
期待結果: [この手続きで得られる結果]
カテゴリ: [procedure|pattern|insight のいずれか]`,
        },
      ],
      maxTokens: 1024,
    });

    const responseText = response.content;
    const titleMatch = responseText.match(/タイトル:\s*(.+)/);
    const categoryMatch = responseText.match(/カテゴリ:\s*(\w+)/);

    const title = titleMatch?.[1]?.trim() ?? `Procedure from task: ${task.title}`;
    const category = categoryMatch?.[1]?.trim() ?? 'procedure';
    const validCategories = ['procedure', 'pattern', 'insight', 'fact', 'preference', 'general'];
    const finalCategory = validCategories.includes(category) ? category : 'procedure';

    const entry = await prisma.knowledgeEntry.create({
      data: {
        sourceType: 'distilled_procedure',
        sourceId: `execution_${executionId}`,
        title,
        content: responseText,
        contentHash: createContentHash(responseText),
        category: finalCategory,
        tags: JSON.stringify(['distilled', 'agent_execution']),
        confidence: 0.8,
        themeId: task.themeId,
        taskId: task.id,
        validationStatus: 'pending',
      },
    });

    await appendEvent({
      eventType: 'distillation_completed',
      actorType: 'system',
      payload: {
        executionId,
        taskId: task.id,
        entryId: entry.id,
      },
    });

    log.info({ executionId, entryId: entry.id, title }, 'Knowledge distilled from execution');

    return entry.id;
  } catch (error) {
    log.error({ err: error, executionId }, 'Failed to distill knowledge from execution');
    return null;
  }
}
