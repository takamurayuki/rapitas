/**
 * NoteFolders
 *
 * Memo folders (design §2.3, Q3: one level): list, create, rename / reorder,
 * delete — always inside the request's workspace (NULL partition when none).
 *
 * Same-name folders are refused here rather than by a unique index: rows with
 * a NULL workspaceId never collide in one. A create or a rename / reorder is
 * one Serializable transaction (check, write, re-check), queued per workspace
 * in this process; a 409 throws inside it, so a refused write leaves nothing
 * behind — no compensating write ever frees a name for someone else.
 *
 * Deleting a folder moves its notes to 未分類 (never deletes them), in the same
 * transaction as the delete, without relying on the FK (a self-healed desktop
 * database may have the column without it).
 *
 * Not responsible for placing notes into folders — see placement-write.
 */
import type { PrismaInstance, PrismaTx } from '../note-record';
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
    readonly code:
      | 'folder_not_found'
      | 'folder_name_taken'
      | 'folder_write_conflict'
      | 'invalid_folder_name',
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

async function nameTaken(db: PrismaTx, name: string, exceptId?: number): Promise<boolean> {
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

/** Tail of the queue of folder writes per workspace, in this process. */
const nameQueues = new Map<string, Promise<unknown>>();

function isWriteConflict(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2034';
}

/**
 * Run one folder write — check, write, re-check — as a Serializable
 * transaction, one at a time per workspace in this process.
 *
 * The queue keeps a second writer from reading while the first is between its
 * write and its commit; Serializable makes the database refuse the same
 * interleaving between processes (PostgreSQL aborts one side, SQLite has a
 * single writer). A refusal is a throw, so the transaction leaves nothing.
 */
async function nameWrite<T>(
  db: PrismaInstance,
  ws: number | null,
  fn: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  const key = String(ws);
  const run = (nameQueues.get(key) ?? Promise.resolve()).then(() =>
    db.$transaction((tx: PrismaTx) => fn(tx), { isolationLevel: 'Serializable' }),
  );
  const tail = run.catch(() => undefined);
  nameQueues.set(key, tail);
  try {
    return (await run) as T;
  } catch (error) {
    if (isWriteConflict(error)) throw new NoteFolderError('folder_write_conflict', 409);
    throw error;
  } finally {
    if (nameQueues.get(key) === tail) nameQueues.delete(key);
  }
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
  return nameWrite(db, ws, async (tx) => {
    if (await nameTaken(tx, name)) throw new NoteFolderError('folder_name_taken', 409);
    const created = (await tx.noteFolder.create({
      data: { name, sortOrder: input.sortOrder ?? 0, workspaceId: ws },
      select: SELECT,
    })) as NoteFolderRecord;
    if (await nameTaken(tx, name, created.id)) throw new NoteFolderError('folder_name_taken', 409);
    return created;
  });
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
  const name = input.name !== undefined ? cleanName(input.name) : undefined;
  if (name !== undefined) data.name = name;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  // NOTE: the whole PATCH is one transaction (review G2 fix1 must-fix 1). The
  // old code wrote the name, re-checked, and wrote the old name back on a
  // duplicate: between those writes the old name looked free to a create, and
  // the sortOrder stayed. A refusal now throws inside the transaction, so
  // nothing of the PATCH — name or sortOrder — survives a 409.
  return nameWrite(db, ws, async (tx) => {
    if (name !== undefined && (await nameTaken(tx, name, id))) {
      throw new NoteFolderError('folder_name_taken', 409);
    }
    const updated = await tx.noteFolder.updateMany({ where: { id, workspaceId: ws }, data });
    if (updated.count !== 1) throw new NoteFolderError('folder_not_found', 404);
    if (name !== undefined && (await nameTaken(tx, name, id))) {
      throw new NoteFolderError('folder_name_taken', 409);
    }
    return (await tx.noteFolder.findFirst({
      where: { id, workspaceId: ws },
      select: SELECT,
    })) as NoteFolderRecord;
  });
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
  const run = async (tx: PrismaTx) => {
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
  return (await db.$transaction((tx: PrismaTx) => run(tx))) as number;
}
