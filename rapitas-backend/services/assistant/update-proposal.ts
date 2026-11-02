/**
 * UpdateProposal
 *
 * Works out which task a sentence is about and what it asks to change —
 * status, priority, theme, due date (#1119 stage 6). Proposes only: the change
 * is applied by `POST /assistant/task-update`, after the user confirms the
 * card this produces.
 *
 * As with the delete proposal, the model's answer is not believed: a task id
 * outside the window, or a change validateTaskChanges rejects, becomes
 * "unclear" rather than a proposal.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import { validateTaskChanges, type TaskChanges } from './task-update';

const logger = createLogger('assistant-update-proposal');

/** A task as the model is shown it. */
export interface UpdateCandidateInput {
  id: number;
  title: string;
  status: string;
  priority: string;
  themeId: number | null;
  dueDate: Date | string | null;
}

/** What comes back: a checked proposal, or what could not be settled. */
export type UpdateProposal =
  | { kind: 'proposal'; taskId: number; title: string; changes: TaskChanges; reason: string }
  | { kind: 'unclear'; unclear: string[] };

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーの発話が、候補一覧のどのタスクの何を変えたいのかを読み取ります。実行はしません。

変えられる項目:
- status: "todo" | "in-progress" | "done"
- priority: "low" | "medium" | "high" | "urgent"
- themeId: テーマの数値ID（発話に明示された場合のみ）
- dueDate: "YYYY-MM-DD"（期限を外すなら null）

守ること:
1. 出力は JSON オブジェクトのみ。
2. taskId は候補一覧に実在する id。どれか確信できなければ null にして unclear に理由を書く。
3. 発話が求めていない項目は changes に入れない。
4. reason に「なぜそう読んだか」を日本語で一文。

JSON の形:
{ "taskId": number | null, "changes": { ... }, "reason": string, "unclear": string[] }`;

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const asText = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * Ask which task the user means and what to change; keep only what checks out.
 *
 * @param text - What the user said / ユーザーの発話
 * @param tasks - The window it may choose from / 選択対象のタスク群
 * @returns A checked proposal, or what was unclear / 検証済みの提案、または不明点
 */
export async function proposeTaskUpdate(
  text: string,
  tasks: UpdateCandidateInput[],
): Promise<UpdateProposal> {
  const utterance = text.trim();
  if (!utterance || tasks.length === 0) {
    return { kind: 'unclear', unclear: ['変更するタスクの候補がありません。'] };
  }
  const list = tasks
    .map(
      (t) =>
        `- id=${t.id} status=${t.status} priority=${t.priority} theme=${t.themeId ?? '-'} 期限=${
          t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '-'
        } 「${t.title}」`,
    )
    .join('\n');

  let raw: Record<string, unknown> | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 512,
      messages: [{ role: 'user', content: `候補一覧:\n${list}\n\nユーザーの発話:\n${utterance}` }],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'update proposal unavailable');
  }
  const unclear = Array.isArray(raw?.unclear)
    ? (raw.unclear as unknown[])
        .map((u) => asText(u))
        .filter((u): u is string => !!u)
        .slice(0, 3)
    : [];
  const fallback = (why: string): UpdateProposal => ({
    kind: 'unclear',
    unclear: unclear.length ? unclear : [why],
  });
  if (!raw) return fallback('発話から変更内容を読み取れませんでした。');

  const task = tasks.find((t) => t.id === raw?.taskId);
  if (!task) return fallback('どのタスクのことか特定できませんでした。');
  const checked = validateTaskChanges((raw.changes ?? {}) as Record<string, unknown>);
  if (!checked.ok) return fallback(`変更内容を受け付けられません: ${checked.error}`);

  return {
    kind: 'proposal',
    taskId: task.id,
    title: task.title,
    changes: checked.changes,
    reason: asText(raw.reason, 300) ?? '',
  };
}
