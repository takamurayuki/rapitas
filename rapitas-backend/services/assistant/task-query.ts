/**
 * TaskQuery
 *
 * Turns a question about the backlog into a query, runs it, and hands back
 * what the database actually said.
 *
 * The split matters. The model reads the question and produces a **query**;
 * it never produces an answer. Every number ラピ reports — counts, dates,
 * titles — comes from the database, so she cannot be confidently wrong about
 * how many tasks are blocked. The worst a bad reading can do is answer a
 * question nobody asked, which the shown query makes obvious.
 *
 * Reads only.
 */
import { prisma } from '../../config/database';
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import { FILTERABLE_STATUSES } from './delete-filter';

const logger = createLogger('assistant-task-query');

/** Most rows an answer carries. A question is not a data export. */
export const MAX_ANSWER_ROWS = 20;

/** Sort orders a question can ask for. */
const ORDERS = ['newest', 'oldest', 'due-soonest'] as const;
export type TaskQueryOrder = (typeof ORDERS)[number];

/** A question, resolved into something the database can run. */
export interface TaskQuery {
  themeId?: number;
  statuses?: string[];
  /** Only tasks touched within this many days. */
  updatedWithinDays?: number;
  /** Only tasks untouched for at least this many days. */
  updatedBeforeDays?: number;
  titleContains?: string;
  order?: TaskQueryOrder;
}

export interface TaskQueryRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  themeId: number | null;
  dueDate: Date | null;
  updatedAt: Date;
}

export interface TaskQueryAnswer {
  /** What the question was taken to mean, shown so a misreading is visible. */
  query: TaskQuery;
  /** The real count, which is always the whole match, not the rows shown. */
  total: number;
  rows: TaskQueryRow[];
  /** What the model could not settle. */
  unclear: string[];
}

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーの質問を、タスク検索の条件に翻訳します。答えそのものは書きません。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. 件数・日付・タイトルなどの「答え」を書かない。条件だけを出す。実際の値はデータベースが返します。
3. themeId はテーマ一覧の id から選ぶ。特定できなければ null。
4. statuses は todo / in-progress / blocked / done / cancelled から選ぶ。問われていなければ空配列。
5. 「最近」「今週」は updatedWithinDays、「放置」「古い」は updatedBeforeDays に translate する。
6. 語句で絞れるなら titleContains に短い語を1つだけ。
7. 判断できなかったことは unclear に最大2件。

JSON の形:
{
  "themeId": number | null,
  "statuses": string[],
  "updatedWithinDays": number | null,
  "updatedBeforeDays": number | null,
  "titleContains": string | null,
  "order": "newest" | "oldest" | "due-soonest",
  "unclear": string[]
}`;

/** What the model returns, before any of it is believed. */
interface RawQuery {
  themeId?: unknown;
  statuses?: unknown;
  updatedWithinDays?: unknown;
  updatedBeforeDays?: unknown;
  titleContains?: unknown;
  order?: unknown;
  unclear?: unknown;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): RawQuery | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawQuery;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

/** A positive whole number of days, or undefined. */
function asDays(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

/**
 * Read a question into a query, keeping only the parts that check out.
 *
 * @param text - The question / 質問
 * @param themeIds - Themes that exist, so an invented id is dropped / 実在するテーマID
 * @returns The query and what it could not settle, or null / 条件（不成立時 null）
 */
export async function interpretQuestion(
  text: string,
  themes: { id: number; name: string }[],
): Promise<{ query: TaskQuery; unclear: string[] } | null> {
  const utterance = text.trim();
  if (!utterance) return null;

  const themeList = themes.map((t) => `- id=${t.id} 「${t.name}」`).join('\n');

  let raw: RawQuery | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 512,
      messages: [{ role: 'user', content: `テーマ一覧:\n${themeList}\n\n質問:\n${utterance}` }],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'question interpretation unavailable');
    return null;
  }
  if (!raw) return null;

  const statuses = Array.isArray(raw.statuses)
    ? raw.statuses.filter(
        (s): s is string =>
          typeof s === 'string' && (FILTERABLE_STATUSES as readonly string[]).includes(s),
      )
    : [];

  const query: TaskQuery = {
    ...(typeof raw.themeId === 'number' && themes.some((t) => t.id === raw.themeId)
      ? { themeId: raw.themeId }
      : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
    ...(asDays(raw.updatedWithinDays) ? { updatedWithinDays: asDays(raw.updatedWithinDays) } : {}),
    ...(asDays(raw.updatedBeforeDays) ? { updatedBeforeDays: asDays(raw.updatedBeforeDays) } : {}),
    ...(asText(raw.titleContains, 60) ? { titleContains: asText(raw.titleContains, 60) } : {}),
    order: (ORDERS as readonly string[]).includes(raw.order as string)
      ? (raw.order as TaskQueryOrder)
      : 'newest',
  };

  const unclear = Array.isArray(raw.unclear)
    ? raw.unclear
        .map((u) => asText(u, 200))
        .filter((u): u is string => !!u)
        .slice(0, 2)
    : [];

  return { query, unclear };
}

/** Translate a query into the shape Prisma wants. */
function toWhere(query: TaskQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (typeof query.themeId === 'number') where.themeId = query.themeId;
  if (query.statuses?.length) where.status = { in: query.statuses };
  if (query.titleContains) where.title = { contains: query.titleContains };

  const day = 24 * 60 * 60 * 1000;
  const updated: Record<string, Date> = {};
  if (query.updatedWithinDays) updated.gte = new Date(Date.now() - query.updatedWithinDays * day);
  if (query.updatedBeforeDays) updated.lt = new Date(Date.now() - query.updatedBeforeDays * day);
  if (Object.keys(updated).length > 0) where.updatedAt = updated;

  return where;
}

/**
 * Run a query and report what the database said.
 *
 * The count is of everything matched, not of the rows returned — an answer
 * that says "5" because it only looked at five would be a lie.
 *
 * @param query - The resolved conditions / 解決済みの条件
 * @returns The real total and a capped sample / 実際の総数と上限付きの行
 */
export async function runTaskQuery(
  query: TaskQuery,
): Promise<{ total: number; rows: TaskQueryRow[] }> {
  const where = toWhere(query);
  const orderBy =
    query.order === 'oldest'
      ? { updatedAt: 'asc' as const }
      : query.order === 'due-soonest'
        ? { dueDate: 'asc' as const }
        : { updatedAt: 'desc' as const };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy,
      take: MAX_ANSWER_ROWS,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        themeId: true,
        dueDate: true,
        updatedAt: true,
      },
    }),
  ]);

  logger.info({ total, returned: rows.length }, 'task question answered');
  return { total, rows };
}
