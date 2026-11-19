/**
 * NoteFolders
 *
 * Memo folders (design §2.3, Q3: one level): list, create, rename / reorder,
 * delete — always inside the request's workspace (NULL partition when none).
 *
 * Same-name folders are refused here rather than by a unique index: rows with
 * a NULL workspaceId never collide in one. Two creates racing past the check
 * are settled after the write — the later row (higher id) is removed and its
 * caller gets the same 409 — so the rule holds without a lock.
 *
 * Deleting a folder moves its notes to 未分類 (never deletes them), in the same
 * transaction as the delete, without relying on the FK (a self-healed desktop
 * database may have the column without it).
 *
 * Not responsible for placing notes into folders — see placement-write.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';

/** Longest folder name accepted. */
export const MAX_FOLDER_NAME = 100;

/** A folder as the API returns it. */
export interface NoteFolderRecord {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Why a folder write was refused. */
export class NoteFolderError extends Error {
  constructor(
    readonly code: 'folder_not_found' | 'folder_name_taken' | 'invalid_folder_name',
    readonly status: 400 | 404 | 409,
  ) {
    super(code);
    this.name = 'NoteFolderError';
  }
}

const SELECT = { id: true, name: true, sortOrder: true, createdAt: true, updatedAt: true } as const;

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > MAX_FOLDER_NAME) {
    throw new NoteFolderError('invalid_folder_name', 400);
  }
  return trimmed;
}

async function nameTaken(db: PrismaInstance, name: string, exceptId?: number): Promise<boolean> {
  const hit = await db.noteFolder.findFirst({
    where: {
      workspaceId: requestWorkspaceId(),
      name,
      ...(exceptId !== undefined ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * The workspace's folders in display order.
 *
 * @param db - Client / クライアント
 * @returns Folders by sortOrder then id / 並び順のフォルダ一覧
 */
export async function listNoteFolders(db: PrismaInstance): Promise<NoteFolderRecord[]> {
  return (await db.noteFolder.findMany({
    where: { workspaceId: requestWorkspaceId() },
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })) as NoteFolderRecord[];
}

/**
 * Create a folder.
 *
 * @param db - Client / クライアント
 * @param input - Name and optional sort order / 名前と並び順
 * @returns The folder / 作成したフォルダ
 * @throws {NoteFolderError} invalid_folder_name (400) or folder_name_taken (409)
 */
export async function createNoteFolder(
  db: PrismaInstance,
  input: { name: string; sortOrder?: number },
): Promise<NoteFolderRecord> {
  const name = cleanName(input.name);
  const ws = requestWorkspaceId();
  if (await nameTaken(db, name)) throw new NoteFolderError('folder_name_taken', 409);
  const created = (await db.noteFolder.create({
    data: { name, sortOrder: input.sortOrder ?? 0, workspaceId: ws },
    select: SELECT,
  })) as NoteFolderRecord;
  // Settle a race with a concurrent create of the same name: the earliest row stays.
  const same = (await db.noteFolder.findMany({
    where: { workspaceId: ws, name },
    select: { id: true },
    orderBy: [{ id: 'asc' }],
  })) as { id: number }[];
  if (same.length > 1 && same[0]?.id !== created.id) {
    await db.noteFolder.deleteMany({ where: { id: created.id, workspaceId: ws } });
    throw new NoteFolderError('folder_name_taken', 409);
  }
  return created;
}

/**
 * Rename and / or reorder a folder.
 *
 * @param db - Client / クライアント
 * @param id - The folder / フォルダID
 * @param input - New name and / or sort order / 新しい名前・並び順
 * @returns The folder / 更新後のフォルダ
 * @throws {NoteFolderError} folder_not_found (404), invalid_folder_name (400), folder_name_taken (409)
 */
export async function updateNoteFolder(
  db: PrismaInstance,
  id: number,
  input: { name?: string; sortOrder?: number },
): Promise<NoteFolderRecord> {
  const ws = requestWorkspaceId();
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    data.name = cleanName(input.name);
    if (await nameTaken(db, data.name as string, id)) {
      throw new NoteFolderError('folder_name_taken', 409);
    }
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  const updated = await db.noteFolder.updateMany({ where: { id, workspaceId: ws }, data });
  if (updated.count !== 1) throw new NoteFolderError('folder_not_found', 404);
  return (await db.noteFolder.findFirst({
    where: { id, workspaceId: ws },
    select: SELECT,
  })) as NoteFolderRecord;
}

/**
 * Delete a folder; its notes become 未分類.
 *
 * @param db - Client / クライアント
 * @param id - The folder / フォルダID
 * @returns How many notes were moved out / 未分類に移したノート数
 * @throws {NoteFolderError} folder_not_found (404)
 */
export async function deleteNoteFolder(db: PrismaInstance, id: number): Promise<number> {
  const ws = requestWorkspaceId();
  const run = async (tx: PrismaInstance) => {
    const folder = await tx.noteFolder.findFirst({
      where: { id, workspaceId: ws },
      select: { id: true },
    });
    if (!folder) throw new NoteFolderError('folder_not_found', 404);
    const moved = await tx.note.updateMany({
      where: { folderId: id, workspaceId: ws },
      data: { folderId: null },
    });
    await tx.noteFolder.deleteMany({ where: { id, workspaceId: ws } });
    return moved.count as number;
  };
  return (await db.$transaction((tx: PrismaInstance) => run(tx))) as number;
}
