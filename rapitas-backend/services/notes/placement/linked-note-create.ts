/**
 * LinkedNoteCreate
 *
 * Creating a note together with its task links, for the two server paths
 * that make notes (design §2.2「作成とリンクは一体」): `POST /notes/batch` and
 * the deliverable automation. Both call these inside ONE interactive
 * transaction, so a note never exists without its links.
 *
 * Only `findFirst` / `create` / `updateMany` are used: the workspace
 * extension emulates `upsert` and unique reads through the base client,
 * i.e. OUTSIDE the transaction, which would break the atomicity.
 *
 * "Create if absent" only — an existing id is never overwritten here; the
 * caller decides what an existing note means (skipped / created).
 *
 * Not responsible for deciding the placement or the body — the callers do.
 */
import type { NoteTaskMeta, PrismaInstance, PrismaTx } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { computeNoteVersion } from '../note-version';
import { resolveEffectiveTheme } from './effective-theme';
import type { ScopedTask } from './placement-scope';
import type { PlacementColumns } from './placement-types';

/** Everything a server-created note is made of. */
export interface LinkedNoteSpec {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  docType?: string | null;
  source: string;
  sourceTaskId: number | null;
  followsTask: boolean;
  sourceRef?: string | null;
  placement: PlacementColumns;
  /** Tasks to link, already checked in scope. */
  taskIds: number[];
  /** Display meta per task (not used for placement). */
  meta: Map<number, NoteTaskMeta>;
}

/**
 * Create the note and its links. Throws (P2002) when the id is taken, which
 * rolls the caller's transaction back.
 *
 * @param tx - The transaction client / トランザクションのクライアント
 * @param spec - What to create / 作成内容
 */
export async function createLinkedNoteTx(tx: PrismaTx, spec: LinkedNoteSpec): Promise<void> {
  const ws = requestWorkspaceId();
  const tags = JSON.stringify(spec.tags ?? []);
  const docType = spec.docType ?? null;
  const version = computeNoteVersion({ title: spec.title, content: spec.content, tags, docType });
  await tx.note.create({
    data: {
      id: spec.id,
      workspaceId: ws,
      title: spec.title,
      content: spec.content,
      tags,
      docType,
      version,
      source: spec.source,
      sourceTaskId: spec.sourceTaskId,
      followsTask: spec.followsTask,
      sourceRef: spec.sourceRef ?? null,
      ...spec.placement,
    },
  });
  await addMissingLinksTx(tx, spec.id, spec.taskIds, spec.meta);
}

/**
 * Add the links a note lacks; existing links (and their meta) are left alone.
 *
 * @param tx - The transaction client / トランザクションのクライアント
 * @param noteId - The note / ノートID
 * @param taskIds - Tasks to link, already checked in scope / リンク先（検証済み）
 * @param meta - Display meta per task / タスクごとの表示用情報
 * @returns How many links were added / 追加したリンク数
 */
export async function addMissingLinksTx(
  tx: PrismaTx,
  noteId: string,
  taskIds: number[],
  meta: Map<number, NoteTaskMeta>,
): Promise<number> {
  const ws = requestWorkspaceId();
  let added = 0;
  for (const taskId of [...new Set(taskIds)]) {
    const existing = await tx.noteTaskLink.findFirst({
      where: { noteId, taskId },
      select: { id: true },
    });
    if (existing) continue;
    const m = meta.get(taskId);
    await tx.noteTaskLink.create({
      data: {
        noteId,
        taskId,
        workspaceId: ws,
        meta: m && Object.keys(m).length > 0 ? JSON.stringify(m) : null,
      },
    });
    added += 1;
  }
  return added;
}

/**
 * The link meta for a task (§3.3「タスクリンクは自動で付ける」): its title and
 * its effective theme's and category's names. Display help only.
 *
 * @param db - Client or transaction / クライアント
 * @param task - The task, in scope / タスク（範囲内）
 * @returns Meta with the keys that have values / 値のある項目だけの meta
 */
export async function taskLinkMeta(db: PrismaInstance, task: ScopedTask): Promise<NoteTaskMeta> {
  const ws = requestWorkspaceId();
  const meta: NoteTaskMeta = {};
  if (task.title) meta.taskTitle = task.title;
  const themeId = await resolveEffectiveTheme(db, task.id);
  if (themeId === null) return meta;
  const theme = (await db.theme.findFirst({
    where: { id: themeId, workspaceId: ws },
    select: { name: true, categoryId: true },
  })) as { name: string; categoryId: number | null } | null;
  if (!theme) return meta;
  meta.themeName = theme.name;
  if (theme.categoryId !== null) {
    const category = (await db.category.findFirst({
      where: { id: theme.categoryId, workspaceId: ws },
      select: { name: true },
    })) as { name: string } | null;
    if (category) meta.categoryName = category.name;
  }
  return meta;
}
