/**
 * DeleteProposal
 *
 * Works out which tasks the user means when they ask for some to be cleared
 * away, and says why for each one.
 *
 * Proposes only. Nothing here deletes, and the ids it returns are a
 * suggestion for the user to look at — `POST /assistant/task-delete` takes
 * the list they approved, which is not necessarily this one.
 *
 * The model chooses from a bounded, recently-touched window rather than the
 * whole backlog: there are over a thousand tasks, and a prompt that cannot
 * fit them is a prompt that silently drops some. The window size is returned
 * so the UI can say what was actually considered instead of implying the
 * answer covers everything.
 *
 * As with the intent reader, most of this is about not trusting the answer:
 * an id that was not in the window is dropped, because the one thing worse
 * than a bad suggestion is a confident one pointing at a task the user never
 * saw.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-delete-proposal');

/** How many recently-touched tasks the model may choose from. */
export const CANDIDATE_WINDOW = 60;

/** A task as the model is shown it. */
export interface DeleteCandidateInput {
  id: number;
  title: string;
  status: string;
  themeId: number | null;
  updatedAt: Date | string;
}

/** One task the model suggests removing. */
export interface DeleteCandidate {
  id: number;
  title: string;
  status: string;
  themeId: number | null;
  /** Why it thinks this one should go, in its own words. */
  reason: string;
}

export interface DeleteProposal {
  candidates: DeleteCandidate[];
  /** How many tasks were in the window, so the UI can say what was weighed. */
  considered: number;
  /** What it could not settle, rather than guessing. */
  unclear: string[];
}

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーが「どのタスクを片付けたいのか」を、与えられた候補一覧から選びます。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. ids は候補一覧に実在する id だけを選ぶ。候補に無いものを挙げない。
3. 迷ったら選ばない。削除は取り返しの手間がかかるので、確信が持てるものだけを挙げる。
4. reasons には id ごとに「なぜ消してよいと判断したか」を日本語で一文ずつ書く。
5. 該当が無ければ ids を空配列にする。無理に選ばない。
6. 判断できなかったことは unclear に最大3件。

JSON の形:
{
  "ids": number[],
  "reasons": { "<id>": string },
  "unclear": string[]
}`;

/** What the model returns, before any of it is believed. */
interface RawProposal {
  ids?: unknown;
  reasons?: unknown;
  unclear?: unknown;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): RawProposal | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawProposal;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

/**
 * Ask which of these tasks the user means, and keep only answers that check out.
 *
 * @param text - What the user said / ユーザーの発話
 * @param tasks - The window of tasks it may choose from / 選択対象のタスク群
 * @returns The proposal, or null when nothing usable came back / 提案（不成立時 null）
 */
export async function proposeDeletions(
  text: string,
  tasks: DeleteCandidateInput[],
): Promise<DeleteProposal | null> {
  const utterance = text.trim();
  if (!utterance || tasks.length === 0) return null;

  const list = tasks
    .map(
      (t) =>
        `- id=${t.id} status=${t.status} theme=${t.themeId ?? '-'} 更新=${new Date(t.updatedAt).toISOString().slice(0, 10)} 「${t.title}」`,
    )
    .join('\n');

  let raw: RawProposal | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 1024,
      messages: [{ role: 'user', content: `候補一覧:\n${list}\n\nユーザーの発話:\n${utterance}` }],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'delete proposal unavailable');
    return null;
  }
  if (!raw) {
    logger.info('model answered without usable JSON');
    return null;
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const reasons = (raw.reasons ?? {}) as Record<string, unknown>;

  // Only ids from the window. A hallucinated one would put a task the user
  // never saw in front of a delete button.
  const ids = Array.isArray(raw.ids)
    ? raw.ids.filter((id): id is number => typeof id === 'number' && byId.has(id))
    : [];

  const candidates: DeleteCandidate[] = ids.map((id) => {
    const task = byId.get(id)!;
    return {
      id,
      title: task.title,
      status: task.status,
      themeId: task.themeId,
      reason: asText(reasons[String(id)]) ?? '',
    };
  });

  const unclear = Array.isArray(raw.unclear)
    ? raw.unclear
        .map((u) => asText(u, 200))
        .filter((u): u is string => !!u)
        .slice(0, 3)
    : [];

  logger.info({ considered: tasks.length, proposed: candidates.length }, 'delete proposal');
  return { candidates, considered: tasks.length, unclear };
}
