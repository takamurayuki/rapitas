/**
 * copilot-intent-responder
 *
 * Deterministic, template-based answers for common factual copilot chat
 * questions (subtask progress, blocked reason, due/estimate, status/
 * priority). Answering these directly from the DB skips the LLM entirely —
 * no local-model inference and no Claude Code CLI subscription usage — for
 * the questions users ask most often. Not responsible for open-ended or
 * analytical questions; those still fall through to sendCopilotMessage's
 * cache/local-LLM/API cascade.
 */
import { prisma } from '../../config/database';

/** Recognized factual-question intents that can be answered without an LLM. */
export type CopilotIntentType =
  | 'subtask_progress'
  | 'blocked_reason'
  | 'due_estimate'
  | 'status_priority';

/**
 * Only short, narrowly-phrased messages are treated as a quick factual
 * lookup — longer messages are more likely to want actual reasoning (e.g.
 * "ステータスを見て次に何をすべきか教えて"), which the template responders
 * below cannot provide, so those fall through to the LLM cascade instead.
 */
const INTENT_MAX_MESSAGE_LENGTH = 40;

const INTENT_PATTERNS: Array<{ intent: CopilotIntentType; pattern: RegExp }> = [
  { intent: 'blocked_reason', pattern: /ブロック.*(理由|なぜ|原因)|なぜ.*ブロック/ },
  { intent: 'subtask_progress', pattern: /サブタスク.*(進捗|状況|完了|残り)/ },
  { intent: 'due_estimate', pattern: /(期限|締切|締め切り|見積もり|見積)/ },
  { intent: 'status_priority', pattern: /(ステータス|状態|優先度)/ },
];

const STATUS_LABELS: Record<string, string> = {
  todo: '未着手',
  'in-progress': '進行中',
  done: '完了',
  blocked: 'ブロック中',
  failed: '失敗',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '緊急',
};

/**
 * `WorkflowTransition.cause` codes for `status==='blocked'` writes, mirrored
 * from the frontend's BLOCKED_CAUSE_I18N_KEYS (workflow-blocked-cause.ts) so
 * this template matches what the workflow section already shows.
 */
const BLOCKED_CAUSE_MESSAGES: Record<string, string> = {
  plan_invalid_replan_exhausted:
    '計画(plan.md)が繰り返し不正だったため、再計画を打ち切ってブロックしました。plan.mdを手動で確認してください。',
  verify_pr_not_created:
    '検証は通過しましたがPRが作成されませんでした。GitHub連携やcommit漏れを確認してください。',
  verify_validation_failed:
    '検証内容に自己矛盾・不備があり、自動修復の上限に達しました。verify.mdを確認してください。',
  verify_no_changes: '検証は通過しましたが実装による変更が検出されませんでした。',
  subtask_failed: '一部のサブタスクが失敗したため、親タスクをブロックしました。',
};

/**
 * Detect a known factual-question intent in a copilot chat message.
 *
 * @param message - Raw user chat message. / ユーザーのチャットメッセージ
 * @returns The matched intent, or null when the message doesn't look like a
 *   short factual lookup. / マッチした意図。該当なしはnull
 */
export function matchCopilotIntent(message: string): CopilotIntentType | null {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > INTENT_MAX_MESSAGE_LENGTH) return null;
  return INTENT_PATTERNS.find(({ pattern }) => pattern.test(trimmed))?.intent ?? null;
}

async function respondSubtaskProgress(taskId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { subtasks: { select: { status: true } } },
  });
  if (!task || task.subtasks.length === 0) return null;
  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.status === 'done').length;
  return `サブタスクの進捗は ${done}/${total} 件完了です。`;
}

async function respondBlockedReason(taskId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (!task) return null;
  if (task.status !== 'blocked') return 'このタスクは現在ブロックされていません。';

  const latest = await prisma.workflowTransition.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    select: { cause: true },
  });
  const cause = latest?.cause;
  if (cause && BLOCKED_CAUSE_MESSAGES[cause]) return BLOCKED_CAUSE_MESSAGES[cause];
  return `タスクがブロックされています${cause ? `（原因コード: ${cause}）` : ''}。`;
}

async function respondDueEstimate(taskId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { dueDate: true, estimatedHours: true, actualHours: true },
  });
  if (!task || (!task.dueDate && task.estimatedHours == null)) return null;

  const parts: string[] = [];
  if (task.dueDate) parts.push(`期限: ${task.dueDate.toISOString().slice(0, 10)}`);
  if (task.estimatedHours != null) {
    const actual = task.actualHours != null ? `（実績: ${task.actualHours}h）` : '';
    parts.push(`見積もり工数: ${task.estimatedHours}h${actual}`);
  }
  return parts.join(' / ');
}

async function respondStatusPriority(taskId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, priority: true },
  });
  if (!task) return null;
  const statusLabel = STATUS_LABELS[task.status] ?? task.status;
  const priorityLabel = PRIORITY_LABELS[task.priority] ?? task.priority;
  return `現在のステータスは「${statusLabel}」、優先度は「${priorityLabel}」です。`;
}

/**
 * Generate the template answer for a matched intent.
 *
 * @param intent - Intent returned by matchCopilotIntent. / matchCopilotIntentの戻り値
 * @param taskId - Task the question is about. / 対象タスクID
 * @returns The answer text, or null when the DB has nothing useful to say
 *   for this intent (caller should fall through to the LLM cascade instead
 *   of returning an empty/unhelpful reply). / DBに答える材料がない場合はnull
 */
export async function respondToIntent(
  intent: CopilotIntentType,
  taskId: number,
): Promise<string | null> {
  switch (intent) {
    case 'subtask_progress':
      return respondSubtaskProgress(taskId);
    case 'blocked_reason':
      return respondBlockedReason(taskId);
    case 'due_estimate':
      return respondDueEstimate(taskId);
    case 'status_priority':
      return respondStatusPriority(taskId);
    default:
      return null;
  }
}
