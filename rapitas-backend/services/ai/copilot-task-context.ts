/**
 * CopilotTaskContext
 *
 * Builds the task context injected ahead of a consult (相談) message, read
 * fresh from the database on every message — the conversation is a record,
 * not the state (companion design ch.0). Besides the task's own fields,
 * subtasks, comments and shared knowledge, it carries what ラピ needs to answer
 * "完了条件は？" and "今どこ？" from the DB rather than from memory: the
 * acceptance criteria, the workflow status, any halt reason, and the last five
 * workflow transitions (companion stage 1, item 3).
 *
 * Not responsible for choosing a model or caching — see copilot-chat-service.
 * The cache key includes this text, so a changed status is a new key.
 */
import { prisma } from '../../config/database';
import { gatherSharedKnowledge, formatKnowledgeContext } from '../agents/agent-knowledge-sharing';

/** How many recent workflow transitions the context lists. */
export const CONTEXT_TRANSITIONS = 5;

/** Workflow statuses in the words the user sees on the task screen. */
const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: '下書き（調査前）',
  research_done: '調査済み',
  plan_created: '計画作成済み（承認待ち）',
  plan_approved: '計画承認済み',
  in_progress: '実装中',
  awaiting_question: '質問への回答待ち',
  verify_done: '検証済み（完了判定中）',
  completed: '完了',
};

/** A workflow status with its label, or the raw code when it is unknown. */
export function describeWorkflowStatus(status: string): string {
  const label = WORKFLOW_STATUS_LABELS[status];
  return label ? `${label}（${status}）` : status;
}

/** The criteria column as a list; tolerant of a malformed value. */
export function parseCriteriaColumn(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

/** One transition, as the context lists it. */
interface TransitionLine {
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  cause: string;
  createdAt: Date;
}

/** The newest transitions, newest first; empty when they cannot be read. */
async function recentTransitions(taskId: number): Promise<TransitionLine[]> {
  try {
    return await prisma.workflowTransition.findMany({
      where: { taskId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CONTEXT_TRANSITIONS,
      select: { fromStatus: true, toStatus: true, actor: true, cause: true, createdAt: true },
    });
  } catch {
    // The rest of the context still helps; a missing history is said plainly below.
    return [];
  }
}

/**
 * Build the context string for a consult about one task.
 *
 * @param taskId - The task being discussed / 相談対象のタスク
 * @returns The context, or empty when the task does not exist / 文脈（タスクが無ければ空）
 */
export async function buildTaskContext(taskId: number): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      theme: { select: { name: true, workingDirectory: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { content: true },
      },
      subtasks: {
        select: { id: true, title: true, status: true },
        take: 10,
      },
    },
  });

  if (!task) return '';

  const parts: string[] = [
    `## タスク: ${task.title}`,
    `ステータス: ${task.status} / 優先度: ${task.priority}`,
  ];

  // Stage and criteria come before the description: they are what "今どこ？"
  // and "完了条件は？" are answered from, and a long description must not push
  // them out of the model's attention.
  parts.push(
    `ワークフローの段階: ${task.workflowStatus ? describeWorkflowStatus(task.workflowStatus) : '未開始'}`,
  );
  if (task.haltReason) {
    parts.push(
      `停止中: ${task.haltReason}${task.haltedAt ? `（${task.haltedAt.toISOString()}）` : ''}`,
    );
  }
  const criteria = parseCriteriaColumn(task.acceptanceCriteria);
  parts.push(
    criteria.length > 0
      ? `完了条件（タスクに登録されているもの。陪審はこれで判定する）:\n${criteria
          .map((c, i) => `${i + 1}. ${c}`)
          .join('\n')}`
      : '完了条件: 登録されていません',
  );

  const transitions = await recentTransitions(taskId);
  if (transitions.length > 0) {
    parts.push(
      `直近の遷移（新しい順、最大${CONTEXT_TRANSITIONS}件）:\n${transitions
        .map(
          (tr) =>
            `- ${tr.createdAt.toISOString()} ${tr.fromStatus ?? '(開始)'} → ${tr.toStatus}（${tr.actor} / ${tr.cause}）`,
        )
        .join('\n')}`,
    );
  }

  if (task.description) parts.push(`説明: ${task.description.slice(0, 500)}`);
  if (task.theme) parts.push(`テーマ: ${task.theme.name}`);

  if (task.subtasks.length > 0) {
    parts.push(`\nサブタスク: ${task.subtasks.map((s) => `[${s.status}] ${s.title}`).join(', ')}`);
  }

  if (task.comments.length > 0) {
    parts.push(
      `\n最近のコメント:\n${task.comments.map((c) => `- ${c.content.slice(0, 150)}`).join('\n')}`,
    );
  }

  // Ground the copilot in the knowledge OS: past success/failure patterns and
  // related knowledge for this task (the same context agents receive before
  // execution). Non-fatal — falls back to task-local context on error.
  try {
    const knowledgeContext = formatKnowledgeContext(await gatherSharedKnowledge(taskId));
    if (knowledgeContext) parts.push(`\n${knowledgeContext}`);
  } catch {
    // ignore — keep task-local context only
  }

  return parts.join('\n');
}
