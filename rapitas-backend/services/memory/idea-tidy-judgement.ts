/**
 * idea-tidy-judgement
 *
 * ラピ's おまかせ idea tidy: the model reads the ideas and proposes groups
 * that are the same idea in different words, and ideas not worth keeping,
 * each with a reason. Proposes only — applying goes through the same
 * confirmed, undoable path as the rule-based tidy (idea-tidy.ts).
 *
 * Why (2026-11-17): the rules found nothing in the real idea box. 92 ideas,
 * the most similar pair at 0.27, all under two weeks old and mostly high
 * priority; the overlap was in meaning, which only a reading catches.
 *
 * As in delete-proposal.ts, most of this is about not trusting the answer:
 * an id that was not in the window is dropped.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import type { DuplicateGroup, TidyIdea, UnneededIdea } from './idea-tidy';

const logger = createLogger('idea-tidy-judgement');

/** How many ideas the model reads; the newest come first. */
export const JUDGEMENT_WINDOW = 100;

/** Characters of each idea's text shown to the model. */
const EXCERPT = 80;

/** The model's proposal, checked against the window. */
export interface JudgedIdeaTidy {
  duplicates: DuplicateGroup[];
  unneeded: UnneededIdea[];
  /** How many ideas were weighed, so the UI says what was read. */
  considered: number;
  /** What it could not settle. */
  unclear: string[];
}

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
アイデアボックスのアイデア一覧を読み、整理の案を出します。

出すもの:
1. groups: 言い回しは違っても「同じ発想」のアイデアのまとまり。ids に2件以上。keepId には残す1件（内容が最も具体的なもの）。reason に「なぜ同じと判断したか」を日本語で一文。
2. unneeded: 残す価値が低いアイデア。中身が無く行動に移せない、他のアイデアに含まれている、など。reason に理由を日本語で一文。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. id は一覧に実在するものだけを使う。
3. 迷ったら挙げない。話題が近いだけ（例: どちらも通知に関する）で、発想が違うものはまとめない。
4. 同じ id を複数の groups や unneeded に入れない。
5. 該当が無ければ空配列にする。無理に挙げない。
6. 判断できなかったことは unclear に最大3件。

JSON の形:
{
  "groups": [{ "ids": number[], "keepId": number, "reason": string }],
  "unneeded": [{ "id": number, "reason": string }],
  "unclear": string[]
}`;

interface RawJudgement {
  groups?: unknown;
  unneeded?: unknown;
  unclear?: unknown;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): RawJudgement | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawJudgement;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/**
 * Ask the model how to tidy these ideas, keeping only answers that check out.
 *
 * @param ideas - Active ideas, newest first / 対象のアイデア（新しい順）
 * @returns The checked proposal, or null when nothing usable came back / 提案（不成立時 null）
 */
export async function judgeIdeaTidy(
  ideas: Array<Pick<TidyIdea, 'id' | 'title' | 'content' | 'priority'>>,
): Promise<JudgedIdeaTidy | null> {
  const window = ideas.slice(0, JUDGEMENT_WINDOW);
  if (window.length === 0) return null;
  const list = window
    .map(
      (i) =>
        `- id=${i.id} 優先度=${i.priority} 「${i.title}」 ${i.content.replace(/\s+/g, ' ').slice(0, EXCERPT)}`,
    )
    .join('\n');

  let raw: RawJudgement | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 2048,
      messages: [{ role: 'user', content: `アイデア一覧:\n${list}` }],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'idea tidy judgement unavailable');
    return null;
  }
  if (!raw) {
    logger.info('model answered without usable JSON');
    return null;
  }

  const byId = new Map(window.map((i) => [i.id, i]));
  const used = new Set<number>();
  const duplicates: DuplicateGroup[] = [];
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const rec = asRecord(g);
    const ids = (Array.isArray(rec.ids) ? rec.ids : []).filter(
      (id): id is number => typeof id === 'number' && byId.has(id) && !used.has(id),
    );
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    const keepId =
      typeof rec.keepId === 'number' && unique.includes(rec.keepId) ? rec.keepId : unique[0];
    unique.forEach((id) => used.add(id));
    duplicates.push({
      keepId,
      reason: asText(rec.reason) ?? '',
      ideas: unique.map((id) => {
        const { title, priority } = byId.get(id)!;
        return { id, title, priority };
      }),
    });
  }

  const unneeded: UnneededIdea[] = [];
  for (const u of Array.isArray(raw.unneeded) ? raw.unneeded : []) {
    const rec = asRecord(u);
    const id = rec.id;
    if (typeof id !== 'number' || !byId.has(id) || used.has(id)) continue;
    used.add(id);
    unneeded.push({
      id,
      title: byId.get(id)!.title,
      reason: 'judged',
      note: asText(rec.reason) ?? '',
    });
  }

  const unclear = (Array.isArray(raw.unclear) ? raw.unclear : [])
    .map((u) => asText(u))
    .filter((u): u is string => !!u)
    .slice(0, 3);

  logger.info(
    { considered: window.length, groups: duplicates.length, unneeded: unneeded.length },
    'idea tidy judgement',
  );
  return { duplicates, unneeded, considered: window.length, unclear };
}
