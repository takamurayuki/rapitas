/**
 * message-service
 *
 * Read pages of a space's messages and save a batch of them atomically
 * (design §4.2): one PUT is written in a single transaction or refused whole,
 * and a refusal names the items responsible so the client can drop just those.
 * Not responsible for the body-shape check (snapshot-limits) or HTTP status codes.
 */
import { inheritWorkspace } from '../tenancy/parent-workspace';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_MESSAGES_PER_SPACE,
  MAX_PAGE_LIMIT,
  type MessageRow,
  type PutItem,
  type RapiChatDb,
  type RejectCode,
  type ValidItem,
} from './rapi-chat-types';
import { autoTitle, validateItem } from './snapshot-limits';

/** The fields of a message the client sees. */
export interface MessageView {
  id: number;
  clientId: string;
  role: string;
  kind: string;
  text: string;
  taskId: number | null;
  inHistory: boolean;
  payload: string | null;
  clientCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toMessageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    clientId: row.clientId,
    role: row.role,
    kind: row.kind,
    text: row.text,
    taskId: row.taskId,
    inHistory: row.inHistory,
    payload: row.payload,
    clientCreatedAt: row.clientCreatedAt ? row.clientCreatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Clamp a requested page size.
 *
 * @param raw - `limit` query value / クエリの limit
 * @returns 1..MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT when absent or invalid / 件数
 */
export function pageLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(n, MAX_PAGE_LIMIT);
}

export interface MessagePage {
  messages: MessageView[];
  hasMore: boolean;
  nextBefore: number | null;
}

/**
 * One page of a space's messages, oldest first, ending just before `before`.
 *
 * @param db - Prisma client / Prisma クライアント
 * @param spaceId - Space id / スペースID
 * @param opts - `before` (exclusive message id) and page size / 境界と件数
 * @returns The page, or null when the space does not exist / ページ（無ければ null）
 */
export async function listMessages(
  db: RapiChatDb,
  spaceId: number,
  opts: { before: number | null; limit: number },
): Promise<MessagePage | null> {
  const space = await db.rapiChatSpace.findFirst({ where: { id: spaceId } });
  if (!space) return null;
  const rows = await db.rapiChatMessage.findMany({
    where: opts.before === null ? { spaceId } : { spaceId, id: { lt: opts.before } },
    orderBy: { id: 'desc' },
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit).reverse();
  return {
    messages: page.map(toMessageView),
    hasMore,
    nextBefore: page.length > 0 ? page[0].id : null,
  };
}

export type PutResult =
  | { kind: 'not_found' }
  | { kind: 'invalid'; rejected: Array<{ clientId: string; code: RejectCode }> }
  | {
      kind: 'limit';
      remaining: number;
      rejected: Array<{ clientId: string; code: 'message_limit' }>;
    }
  | {
      kind: 'saved';
      saved: Array<{ clientId: string; id: number }>;
      removed: string[];
      space: { title: string | null; messageCount: number; lastMessageAt: string | null };
    };

/**
 * Save one batch of messages: upsert by (spaceId, clientId), delete the
 * `deleted` ones, then set the automatic title and the denormalised counts.
 *
 * @param db - Prisma client / Prisma クライアント
 * @param spaceId - Space id / スペースID
 * @param items - Items that passed the body-shape check / 形の検査を通った項目
 * @returns Saved, or why the whole batch was refused / 保存結果か、断った理由
 */
export async function putMessages(
  db: RapiChatDb,
  spaceId: number,
  items: PutItem[],
): Promise<PutResult> {
  const valid: ValidItem[] = [];
  const rejected: Array<{ clientId: string; code: RejectCode }> = [];
  for (const item of items) {
    const r = validateItem(item);
    if (r.ok) valid.push(r.item);
    else rejected.push({ clientId: item.clientId, code: r.code });
  }

  return db.$transaction(async (tx): Promise<PutResult> => {
    const space = await tx.rapiChatSpace.findFirst({ where: { id: spaceId } });
    if (!space) return { kind: 'not_found' };
    if (rejected.length > 0) return { kind: 'invalid', rejected };

    const ids = valid.map((v) => v.clientId);
    const existingRows =
      ids.length === 0
        ? []
        : await tx.rapiChatMessage.findMany({
            where: { spaceId, clientId: { in: ids } },
            select: { clientId: true },
          });
    const existing = new Set(existingRows.map((r) => r.clientId));
    const current = await tx.rapiChatMessage.count({ where: { spaceId } });
    const creates = valid.filter((v) => !v.deleted && !existing.has(v.clientId));
    const deletes = valid.filter((v) => v.deleted && existing.has(v.clientId));

    // Judged on the count AFTER this PUT: overwrites and resends add nothing (§4.2 A2).
    if (current + creates.length - deletes.length > MAX_MESSAGES_PER_SPACE) {
      return {
        kind: 'limit',
        remaining: Math.max(0, MAX_MESSAGES_PER_SPACE - (current - deletes.length)),
        rejected: creates.map((c) => ({ clientId: c.clientId, code: 'message_limit' as const })),
      };
    }

    for (const d of deletes) {
      await tx.rapiChatMessage.deleteMany({ where: { spaceId, clientId: d.clientId } });
    }
    let wrote = false;
    for (const v of valid) {
      if (v.deleted) continue;
      wrote = true;
      const data = {
        role: v.role,
        kind: v.kind,
        text: v.text,
        taskId: v.taskId,
        inHistory: v.inHistory,
        payload: v.payload,
        clientCreatedAt: v.clientCreatedAt,
      };
      if (existing.has(v.clientId)) {
        await tx.rapiChatMessage.updateMany({ where: { spaceId, clientId: v.clientId }, data });
      } else {
        await tx.rapiChatMessage.create({
          // The message takes its space's workspace so a sessionless write
          // never leaves a child NULL under a scoped parent.
          data: { ...data, spaceId, clientId: v.clientId, ...inheritWorkspace(space) },
        });
      }
    }

    const savedRows =
      ids.length === 0
        ? []
        : await tx.rapiChatMessage.findMany({
            where: { spaceId, clientId: { in: ids } },
            select: { clientId: true, id: true },
          });

    let title = space.title;
    if (space.titleSource === 'auto' && title === null) {
      const first = await tx.rapiChatMessage.findFirst({
        where: { spaceId, role: 'user', kind: 'text' },
        orderBy: { id: 'asc' },
      });
      if (first) title = autoTitle(first.text);
    }
    const messageCount = await tx.rapiChatMessage.count({ where: { spaceId } });
    const lastMessageAt = wrote ? new Date() : space.lastMessageAt;
    await tx.rapiChatSpace.updateMany({
      where: { id: spaceId },
      data: { title, messageCount, lastMessageAt },
    });

    return {
      kind: 'saved',
      saved: savedRows.map((r) => ({ clientId: r.clientId, id: r.id })),
      removed: valid.filter((v) => v.deleted).map((v) => v.clientId),
      space: {
        title,
        messageCount,
        lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null,
      },
    };
  });
}
