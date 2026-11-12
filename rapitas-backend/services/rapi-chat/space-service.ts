/**
 * space-service
 *
 * List, create and delete ラピ's conversation spaces (design §4.2, §6.5, §9).
 * Not responsible for the messages inside a space — see message-service — nor
 * for workspace filtering of reads, which the workspace extension owns.
 */
import { currentWorkspaceId } from '../tenancy/workspace-context';
import { MAX_SPACES, type RapiChatDb, type SpaceRow } from './rapi-chat-types';

/** The fields of a space the client sees. */
export interface SpaceView {
  id: number;
  title: string | null;
  titleSource: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape a space row for the client.
 *
 * @param row - Stored row / 保存された行
 * @returns Client view / 返す形
 */
export function toSpaceView(row: SpaceRow): SpaceView {
  return {
    id: row.id,
    title: row.title,
    titleSource: row.titleSource,
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every space visible to the request, newest activity first.
 *
 * NOTE: No workspace condition here on purpose — a cookie-less request (the
 * mobile app today) sees every workspace, matching the existing rule (§4.2).
 *
 * @param db - Prisma client / Prisma クライアント
 * @returns Spaces ordered by lastMessageAt (createdAt when null), newest first / 新しい順
 */
export async function listSpaces(db: RapiChatDb): Promise<SpaceView[]> {
  const rows = await db.rapiChatSpace.findMany({});
  const at = (r: SpaceRow) => (r.lastMessageAt ?? r.createdAt).getTime();
  return rows.sort((a, b) => at(b) - at(a) || b.id - a.id).map(toSpaceView);
}

export type CreateSpaceResult =
  | { kind: 'created'; space: SpaceView }
  | { kind: 'existing'; space: SpaceView }
  | { kind: 'limit' };

/**
 * Create a space, or return the one a previous attempt with the same clientKey
 * already made (design §6.5: a resend after a lost response must not make two).
 *
 * @param db - Prisma client / Prisma クライアント
 * @param input - Optional title and clientKey / 任意の title と clientKey
 * @returns Created, existing, or refused for the space limit / 作成・既存・上限
 */
export async function createSpace(
  db: RapiChatDb,
  input: { title: string | null; clientKey: string | null },
): Promise<CreateSpaceResult> {
  // Counted with an explicit condition: a cookie-less request is not filtered
  // by the extension, so a bare count() would add up every workspace (§4.2 A3).
  const ws = currentWorkspaceId();
  return db.$transaction(async (tx) => {
    if (input.clientKey) {
      const found = await tx.rapiChatSpace.findFirst({
        where: { clientKey: input.clientKey, workspaceId: ws },
      });
      if (found) return { kind: 'existing', space: toSpaceView(found) };
    }
    const count = await tx.rapiChatSpace.count({ where: { workspaceId: ws } });
    if (count >= MAX_SPACES) return { kind: 'limit' };
    const row = await tx.rapiChatSpace.create({
      data: { title: input.title, clientKey: input.clientKey },
    });
    return { kind: 'created', space: toSpaceView(row) };
  });
}

/**
 * Delete a space; its messages go with it through the foreign key's cascade.
 *
 * @param db - Prisma client / Prisma クライアント
 * @param id - Space id / スペースID
 * @returns Messages deleted, or null when the space does not exist / 削除件数（無ければ null）
 */
export async function deleteSpace(db: RapiChatDb, id: number): Promise<number | null> {
  return db.$transaction(async (tx) => {
    const space = await tx.rapiChatSpace.findFirst({ where: { id } });
    if (!space) return null;
    const messages = await tx.rapiChatMessage.count({ where: { spaceId: id } });
    // deleteMany rather than delete: a row removed by another device in between
    // must not throw — DELETE is idempotent for the client (§4.2).
    await tx.rapiChatSpace.deleteMany({ where: { id } });
    return messages;
  });
}
