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
  toRecord,
  WITH_LINKS,
  type NoteInput,
  type NoteRecord,
  type NoteRow,
  type PrismaInstance,
  type SanitizedNoteInput,
} from './note-record';
import { computeNoteVersion, type NoteVersionFields } from './note-version';
import { requestWorkspaceId, scopeWhere } from './note-scope';
import { checkNewMarkdownContent, type NewMarkdownRejection } from './note-content-kind';

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
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = (await prisma.note.findFirst({
      where: { id, ...scopeWhere() },
    })) as NoteRow | null;

    if (!current) {
      const version = computeNoteVersion(finalVersionFields(null, data));
      try {
        const row = await prisma.note.create({
          // A note has to have a title column even when the caller only sent
          // content, so creation falls back to an empty one rather than refusing.
          data: { id, title: '', ...data, version, workspaceId: requestWorkspaceId() },
          include: WITH_LINKS,
        });
        return toRecord(row as NoteRow);
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
      data: { ...data, version },
    });
    if (updated.count === 1) {
      const row = await prisma.note.findFirst({
        where: { id, ...scopeWhere() },
        include: WITH_LINKS,
      });
      if (row) return toRecord(row as NoteRow);
    }
  }
  logger.warn({ noteId: id }, 'note write lost every attempt; nothing written');
  throw new NoteWriteConflictError(id);
}

/** What an import did, per id, so a resumable client can record it. */
export interface ImportResult {
  imported: number;
  skipped: number;
  importedIds: string[];
  skippedIds: string[];
}

/**
 * Take in notes that were living in a browser.
 *
 * Existing ids are left alone rather than overwritten: the import runs from
 * whichever browser still has local notes, possibly more than once and
 * possibly after the server copy has moved on. Skipping is the only choice
 * that cannot destroy the newer version. Bodies are taken as they are —
 * including the old editor's HTML, the one read-only migration exception.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param notes - What the browser had / ブラウザが持っていたノート
 * @returns Counts and ids taken in and already present / 取り込み件数と既存件数（ID付き）
 */
export async function importNotes(
  prisma: PrismaInstance,
  notes: ({ id: string } & NoteInput)[],
): Promise<ImportResult> {
  const importedIds: string[] = [];
  const skippedIds: string[] = [];
  for (const note of notes) {
    const existing = await prisma.note.findUnique({ where: { id: note.id } });
    if (existing) {
      skippedIds.push(note.id);
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
      // Same id written since the check (or held by another workspace): the
      // server's copy wins, exactly as if it had been there first.
      if (!isUniqueViolation(error)) throw error;
      skippedIds.push(id);
    }
  }
  logger.info({ imported: importedIds.length, skipped: skippedIds.length }, 'notes imported');
  return {
    imported: importedIds.length,
    skipped: skippedIds.length,
    importedIds,
    skippedIds,
  };
}
