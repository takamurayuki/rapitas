/**
 * NoteWrite
 *
 * Every write that sets a note's title, content, tags or docType, held to one
 * contract (design §5.3): the stored four fields and the stored `version`
 * always agree.
 *
 * How: read the row, apply the request's fields to get the FINAL value,
 * compute `version` from that, and write the fields and the version in one
 * `updateMany` conditioned on the version that was read (option (b) of the
 * design, used on both PostgreSQL and SQLite — SQLite has no row lock and the
 * codebase does not use `SELECT ... FOR UPDATE` elsewhere). Zero rows updated
 * means someone wrote in between; read again and retry, up to
 * MAX_WRITE_ATTEMPTS, then give up with a conflict rather than write blind.
 *
 * Never: compute `version` from anything but the final value, or write
 * `version` in an unconditioned update. Either lets a partial update pair a
 * new title with an old body's version.
 *
 * Not responsible for the migration's own conditional write (note-migration)
 * or for links (note-links).
 */
import { createLogger } from '../../config/logger';
import {
  sanitize,
  WITH_LINKS,
  type NoteInput,
  type NoteRecord,
  type NoteRow,
  type PrismaInstance,
  type SanitizedNoteInput,
} from './note-record';
import { computeNoteVersion, type NoteVersionFields } from './note-version';
import { isInScope, requestWorkspaceId, scopeWhere } from './note-scope';
import { checkNewMarkdownContent, type NewMarkdownRejection } from './note-content-kind';
import {
  guardPlacementWrite,
  placementWriteData,
  resolvePlacementTarget,
} from './placement/placement-write';
import { isReservedNoteId } from './placement/placement-types';
import { attachPlacement } from './placement/placed-record';

const logger = createLogger('note-write');

/** How many read-then-conditional-write rounds a save gets before a 409. */
export const MAX_WRITE_ATTEMPTS = 3;

/** The note kept moving under the write; nothing was written. */
export class NoteWriteConflictError extends Error {
  constructor(readonly noteId: string) {
    super(`note ${noteId} changed during every write attempt`);
    this.name = 'NoteWriteConflictError';
  }
}

/**
 * A normal create or edit sent a body that is not new Markdown — the old
 * rich editor's HTML. Only `/notes/import` and `migration/resolve` take that.
 */
export class NoteContentRejectedError extends Error {
  constructor(readonly reason: NewMarkdownRejection) {
    super(`note content rejected: ${reason}`);
    this.name = 'NoteContentRejectedError';
  }
}

/**
 * Whether Prisma refused a create because the id already exists.
 *
 * @param error - What the create threw / 発生したエラー
 * @returns true for a unique violation / 一意制約違反なら true
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * The four compared fields after a write, from the current row (or the create
 * defaults when there is none) with the sent fields applied.
 *
 * @param current - The row as read, or null when creating / 読んだ行（作成時は null）
 * @param data - The sanitized fields being written / 書き込む項目
 * @returns The final four fields / 書き込み後の4項目
 */
export function finalVersionFields(
  current: Pick<NoteRow, 'title' | 'content' | 'tags' | 'docType'> | null,
  data: SanitizedNoteInput,
): NoteVersionFields {
  return {
    title: data.title ?? current?.title ?? '',
    content: data.content ?? current?.content ?? '',
    tags: data.tags ?? current?.tags ?? '[]',
    docType: data.docType !== undefined ? data.docType : (current?.docType ?? null),
  };
}

/**
 * The condition that a row is still at the version it was read at.
 *
 * NOTE: a row the backfill has not reached has a NULL version, and NULL never
 * equals NULL in SQL's `=`; for those the read `updatedAt` stands in (design
 * §5.3「既存の行の埋め戻し」).
 *
 * @param row - The row as read / 読んだ行
 * @returns A `where` fragment / where 条件の断片
 */
export function readVersionCondition(row: {
  version?: string | null;
  updatedAt: Date;
}): { version: string } | { version: null; updatedAt: Date } {
  return row.version ? { version: row.version } : { version: null, updatedAt: row.updatedAt };
}

/**
 * Write a note under the id the caller chose, creating or updating it.
 *
 * The caller owning the id is the point: a browser's existing note keeps the
 * id its links already use. Only the sent fields change; `version` is
 * recomputed from the final value under the conditional write above.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The id to write under / 書き込むID
 * @param input - What to set / 設定する内容
 * @returns The stored note / 保存後のノート
 * @throws {NoteContentRejectedError} when the body is legacy editor HTML / 本文が旧エディタの HTML のとき
 * @throws {NoteWriteConflictError} when every attempt lost a race / すべての試行で競合したとき
 */
export async function saveNote(
  prisma: PrismaInstance,
  id: string,
  input: NoteInput,
): Promise<NoteRecord> {
  // A write that sends no body (title, tags, pin only) is accepted even on an
  // HTML note; only a body that is itself legacy HTML is refused (design §5.3).
  if (input.content !== undefined) {
    const rejection = checkNewMarkdownContent(input.content);
    if (rejection) throw new NoteContentRejectedError(rejection);
  }
  const data = sanitize(input);
  // Stage 1: the placement target is checked in scope before any write.
  const columns = input.placement ? await resolvePlacementTarget(prisma, input.placement) : null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = (await prisma.note.findFirst({
      where: { id, ...scopeWhere() },
    })) as NoteRow | null;
    guardPlacementWrite(id, current, input);
    const extra = placementWriteData(current, input, columns);

    if (!current) {
      const version = computeNoteVersion(finalVersionFields(null, data));
      try {
        const row = await prisma.note.create({
          // A note has to have a title column even when the caller only sent
          // content, so creation falls back to an empty one rather than refusing.
          data: { id, title: '', ...data, ...extra, version, workspaceId: requestWorkspaceId() },
          include: WITH_LINKS,
        });
        return (await attachPlacement(prisma, [row as NoteRow]))[0] as NoteRecord;
      } catch (error) {
        // Created concurrently (or the id is held outside this workspace):
        // read again and take the update branch, or run out of attempts.
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    const version = computeNoteVersion(finalVersionFields(current, data));
    const updated = await prisma.note.updateMany({
      where: { id, ...scopeWhere(), ...readVersionCondition(current) },
      data: { ...data, ...extra, version },
    });
    if (updated.count === 1) {
      const row = await prisma.note.findFirst({
        where: { id, ...scopeWhere() },
        include: WITH_LINKS,
      });
      if (row) return (await attachPlacement(prisma, [row as NoteRow]))[0] as NoteRecord;
    }
  }
  logger.warn({ noteId: id }, 'note write lost every attempt; nothing written');
  throw new NoteWriteConflictError(id);
}

/** What an import did, per id, so a resumable client can record it. */
export interface ImportResult {
  imported: number;
  skipped: number;
  /** Ids held by another workspace: not stored here, and a resend will not store them. */
  conflicted: number;
  importedIds: string[];
  /** Ids this workspace already has — the idempotent "already taken in". */
  skippedIds: string[];
  conflictIds: string[];
}

/**
 * Which workspace holds an id, if any row does.
 *
 * NOTE: `Note.id` is one primary key across every workspace, so an id can be
 * taken by a row this request cannot see. That is not "already imported":
 * the note is not in the requested workspace and resending will not put it
 * there, so the import reports it apart from the skips (design §2.2, §5.3
 * completion condition 2).
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @param id - The id to look up / 調べるID
 * @returns The holder's workspace, or null when no row has the id / 持ち主の区画（無ければ null）
 */
async function findHolder(
  prisma: PrismaInstance,
  id: string,
): Promise<{ workspaceId: number | null } | null> {
  return (await prisma.note.findUnique({
    where: { id },
    select: { workspaceId: true },
  })) as { workspaceId: number | null } | null;
}

/**
 * Take in notes that were living in a browser.
 *
 * Ids the requested workspace already has are left alone rather than
 * overwritten: the import runs from whichever browser still has local notes,
 * possibly more than once and possibly after the server copy has moved on.
 * Skipping is the only choice that cannot destroy the newer version. Ids
 * held by another workspace come back as `conflictIds`, never as skips.
 * Bodies are taken as they are — including the old editor's HTML, the one
 * read-only migration exception.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param notes - What the browser had / ブラウザが持っていたノート
 * @returns Counts and ids taken in, already present, and held elsewhere / 取り込み・既存・別区画の衝突の件数とID
 */
export async function importNotes(
  prisma: PrismaInstance,
  notes: ({ id: string } & NoteInput)[],
): Promise<ImportResult> {
  const importedIds: string[] = [];
  const skippedIds: string[] = [];
  const conflictIds: string[] = [];
  const record = (id: string, kind: 'skipped' | 'conflict') =>
    (kind === 'skipped' ? skippedIds : conflictIds).push(id);
  for (const note of notes) {
    const existing = await findHolder(prisma, note.id);
    // A reserved fixed id belongs to the deliverable path (contract 8).
    if (existing || isReservedNoteId(note.id)) {
      record(note.id, existing && isInScope(existing) ? 'skipped' : 'conflict');
      continue;
    }
    const { id, ...rest } = note;
    const data = sanitize(rest);
    const version = computeNoteVersion(finalVersionFields(null, data));
    try {
      await prisma.note.create({
        data: { id, title: '', ...data, version, workspaceId: requestWorkspaceId() },
      });
      importedIds.push(id);
    } catch (error) {
      // Same id written since the check: the server's copy wins if it is in
      // this workspace, exactly as if it had been there first; elsewhere it
      // is a conflict like any other.
      if (!isUniqueViolation(error)) throw error;
      record(id, isInScope(await findHolder(prisma, id)) ? 'skipped' : 'conflict');
    }
  }
  logger.info(
    {
      imported: importedIds.length,
      skipped: skippedIds.length,
      conflicted: conflictIds.length,
    },
    'notes imported',
  );
  return {
    imported: importedIds.length,
    skipped: skippedIds.length,
    conflicted: conflictIds.length,
    importedIds,
    skippedIds,
    conflictIds,
  };
}
