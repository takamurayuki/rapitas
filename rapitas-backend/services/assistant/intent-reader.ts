/**
 * IntentReader
 *
 * Reads what the user actually wants out of what they said, and shapes it
 * into a proposed task.
 *
 * This is the part `task-draft.ts` cannot do. That one matches patterns — a
 * theme is found only when its name appears verbatim, a priority only when
 * the word "緊急" is present — which makes it a form with the fields guessed,
 * not an assistant that understood anything. Someone saying "アバターの吹き出し
 * が長文だと崩れる" never mentions rapitas, and the pattern matcher has no way
 * to know that is what they meant.
 *
 * So the model decides, and this module's real job is not trusting it: a
 * theme id is only accepted if it exists, a priority only if it is one of the
 * four, an estimate only if it is a positive number. Anything else is dropped
 * and reported as missing, for the user to settle.
 *
 * Returns null whenever it cannot produce something usable — the aux AI is
 * off, the CLI slot is busy, the answer was prose. The caller falls back to
 * the pattern reader rather than failing.
 *
 * Not responsible for writing anything.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import type { DraftField, TaskDraft, ThemeRef } from './task-draft';

const logger = createLogger('assistant-intent');

/** A theme as the model is shown it. */
export interface ThemeChoice extends ThemeRef {
  description?: string | null;
}

/** Priorities the task model accepts. Anything else from the model is dropped. */
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
type Priority = (typeof PRIORITIES)[number];

/** Keeps one bad answer from becoming an enormous task body. */
const MAX_CRITERIA = 6;
const MAX_CRITERION_LENGTH = 200;

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーの発話から「何をしたいのか」を読み取り、1件のタスクの下書きを作ります。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. タイトルは日本語40文字以内、体言止め。発話の言い回しをそのまま切り貼りせず、何をするタスクなのかが分かる形にする。
3. themeId は与えられたテーマ一覧の id から選ぶ。発話にテーマ名が無くても、内容から判断して選ぶこと。どうしても判断できないときだけ null にする。
4. themeReason には、そのテーマを選んだ理由を日本語で一文で書く。
5. 発話に書かれていないことを埋めない。優先度・期日・見積もりは、発話から読み取れないなら null にする。
6. acceptanceCriteria は「何がどうなったら完了か」を検証可能な形で1〜3件。判断材料が無ければ空配列にする。
7. 判断できなかったことは unclear に日本語で列挙する。

JSON の形:
{
  "title": string,
  "summary": string,
  "themeId": number | null,
  "themeReason": string,
  "priority": "urgent" | "high" | "medium" | "low" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "estimatedHours": number | null,
  "acceptanceCriteria": string[],
  "unclear": string[]
}`;

/** What the model is asked to return, before any of it is believed. */
interface RawIntent {
  title?: unknown;
  summary?: unknown;
  themeId?: unknown;
  themeReason?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  estimatedHours?: unknown;
  acceptanceCriteria?: unknown;
  unclear?: unknown;
}

/** A draft read from meaning rather than from patterns. */
export interface IntentDraft extends TaskDraft {
  /** Why that theme, in the model's words. Free text, not a translatable code. */
  themeReason?: string;
  /** What it proposes "done" means, for the user to accept or edit. */
  acceptanceCriteria: string[];
  /** What it could not work out and would otherwise have guessed. */
  unclear: string[];
}

/**
 * Pull the first JSON object out of a reply that may be fenced or chatty.
 *
 * @param text - The model's raw reply / モデルの生出力
 * @returns The parsed object, or null / 解析結果（失敗時 null）
 */
function extractJson(text: string): RawIntent | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawIntent;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

/** The date only if it is one, normalised to an ISO instant. */
function asDueDate(value: unknown): string | undefined {
  const text = asText(value, 40);
  if (!text) return undefined;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Ask the model what the user meant, and keep only the parts that check out.
 *
 * @param text - What the user said / ユーザーの発話
 * @param themes - Every theme it may choose from / 選択肢となる全テーマ
 * @returns The draft, or null when nothing usable came back / 下書き（不成立時 null）
 */
export async function readTaskIntent(
  text: string,
  themes: ThemeChoice[],
): Promise<IntentDraft | null> {
  const utterance = text.trim();
  if (!utterance) return null;

  const themeList = themes
    .map((t) => `- id=${t.id} 名前="${t.name}"${t.description ? ` 用途="${t.description}"` : ''}`)
    .join('\n');

  let raw: RawIntent | null = null;
  try {
    const response = await sendAIMessage({
      // 'ollama' is the house routing for auxiliary work: local model first,
      // then the subscription CLI. It is not an API-billed call.
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 1024,
      messages: [
        {
          role: 'user',
          content: `テーマ一覧:\n${themeList}\n\nユーザーの発話:\n${utterance}`,
        },
      ],
    });
    raw = extractJson(response.content);
  } catch (err) {
    // Off, unconfigured, or busy. None of these should take the feature down
    // — the caller falls back to the pattern reader.
    logger.info({ err }, 'intent reading unavailable; falling back');
    return null;
  }

  if (!raw) {
    logger.info('model answered without usable JSON; falling back');
    return null;
  }

  const title = asText(raw.title, 200);
  if (!title) return null;

  const missing: DraftField[] = [];

  // Only an id that actually exists. A hallucinated one would file the task
  // under a theme that is not there, which is worse than asking.
  const themeId =
    typeof raw.themeId === 'number' && themes.some((t) => t.id === raw.themeId)
      ? raw.themeId
      : undefined;
  if (themeId === undefined) missing.push('theme');

  const priority = PRIORITIES.includes(raw.priority as Priority)
    ? (raw.priority as Priority)
    : undefined;

  const estimatedHours =
    typeof raw.estimatedHours === 'number' && raw.estimatedHours > 0
      ? raw.estimatedHours
      : undefined;

  const dueDate = asDueDate(raw.dueDate);

  const acceptanceCriteria = Array.isArray(raw.acceptanceCriteria)
    ? raw.acceptanceCriteria
        .map((c) => asText(c, MAX_CRITERION_LENGTH))
        .filter((c): c is string => !!c)
        .slice(0, MAX_CRITERIA)
    : [];

  const unclear = Array.isArray(raw.unclear)
    ? raw.unclear.map((u) => asText(u, 200)).filter((u): u is string => !!u)
    : [];

  const summary = asText(raw.summary, 500);

  return {
    title,
    // The utterance is kept whole. The summary is the model's reading of it,
    // which is useful but is not what the user said.
    description: summary ? `${utterance}\n\n---\n${summary}` : utterance,
    ...(priority ? { priority } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(estimatedHours ? { estimatedHours } : {}),
    ...(themeId !== undefined ? { themeId } : {}),
    ...(asText(raw.themeReason, 300) ? { themeReason: asText(raw.themeReason, 300) } : {}),
    themeCandidates: themeId !== undefined ? themes.filter((t) => t.id === themeId) : themes,
    missing,
    reasons: {},
    acceptanceCriteria,
    unclear,
  };
}
