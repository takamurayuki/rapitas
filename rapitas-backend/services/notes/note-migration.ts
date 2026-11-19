/**
 * NoteMigration
 *
 * The server half of moving a desktop browser's notes onto the server
 * (design §5.3): a body-free manifest to diff against, and the one write that
 * may replace an existing note with the browser's version.
 *
 * The replace is conditional in the database, never read-then-write: the
 * update's `where` carries `version = ifVersion`, the version the client was
 * shown, so a phone edit that lands after the diff is not overwritten. Before
 * that, a note already at the sent version answers `alreadyApplied` without
 * writing, which is what makes a resend after a lost response harmless.
 *
 * Not responsible for importing notes the server lacks (note-write's
 * importNotes) or for links (note-links).
 */
import { sanitize, WITH_LINKS, type NoteRow, type PrismaInstance } from './note-record';
import { computeContentSha256, computeNoteVersion } from './note-version';
import { finalVersionFields } from './note-write';
import { backfillNoteVersions } from './note-version-backfill';
import { scopeWhere } from './note-scope';

/** One note as the manifest lists it: everything compared, but no body. */
export interface ManifestEntry {
  id: string;
  updatedAt: Date;
  version: string;
  title: string;
  tags: string[];
  docType: string | null;
  contentSha256: string;
  linkedTaskIds: number[];
}

/** Some rows still have no version; the client should ask again shortly. */
export class VersionsPendingError extends Error {
  constructor(readonly pending: number) {
    super(`${pending} note(s) have no version yet`);
    this.name = 'VersionsPendingError';
  }
}

function readTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

function toEntry(row: NoteRow & { version: string }): ManifestEntry {
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    version: row.version,
    title: row.title,
    tags: readTags(row.tags),
    docType: row.docType ?? null,
    contentSha256: computeContentSha256(row.content),
    linkedTaskIds: (row.taskLinks ?? []).map((l) => l.taskId),
  };
}

/**
 * Every note in the request's scope, with its version, for the client to diff.
 *
 * Backfills missing versions first, so nothing is listed without one.
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @returns The manifest / 版情報の一覧
 * @throws {VersionsPendingError} when a row is still being edited too fast to backfill / 埋め戻せない行が残ったとき
 */
export async function buildMigrationManifest(prisma: PrismaInstance): Promise<ManifestEntry[]> {
  await backfillNoteVersions(prisma);
  const rows = (await prisma.note.findMany({
    where: scopeWhere(),
    include: WITH_LINKS,
    orderBy: { id: 'asc' },
  })) as NoteRow[];
  const pending = rows.filter((r) => !r.version).length;
  if (pending > 0) throw new VersionsPendingError(pending);
  return rows.map((r) => toEntry(r as NoteRow & { version: string }));
}

/** The browser's version of one note, and the server version it was diffed against. */
export interface ResolveItem {
  id: string;
  ifVersion: string;
  title: string;
  content: string;
  tags: string[];
  docType: string | null;
}

/** What happened to one resolve item. */
export type ResolveOutcome =
  | { id: string; status: 'applied' | 'alreadyApplied' }
  | { id: string; status: 'conflict'; current: ManifestEntry | null };

async function currentEntry(prisma: PrismaInstance, id: string): Promise<ManifestEntry | null> {
  const row = (await prisma.note.findFirst({
    where: { id, ...scopeWhere() },
    include: WITH_LINKS,
  })) as NoteRow | null;
  if (!row) return null;
  const version = row.version ?? computeNoteVersion(row);
  return toEntry({ ...row, version });
}

/**
 * Write the browser's version of a note the server already has, if and only
 * if the server is still at the version the client diffed against.
 *
 * Accepts the old editor's HTML: this is the read-only migration exception
 * for a same-id note (design §5.3「PC の版が旧 HTML の場合」).
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param item - The id, ifVersion and the four fields / ID・照合版・4項目
 * @returns applied, alreadyApplied, or conflict with the current version / 結果
 */
export async function resolveMigrationItem(
  prisma: PrismaInstance,
  item: ResolveItem,
): Promise<ResolveOutcome> {
  const data = sanitize({
    title: item.title,
    content: item.content,
    tags: item.tags,
    docType: item.docType,
  });
  // All four fields are written, even ones equal to the server's, so the
  // stored fields are exactly the ones the version was computed from.
  const fields = finalVersionFields(null, data);
  const sentVersion = computeNoteVersion(fields);
  const { id } = item;

  const current = (await prisma.note.findFirst({
    where: { id, ...scopeWhere() },
    select: { id: true, version: true },
  })) as { id: string; version: string | null } | null;
  if (!current) return { id, status: 'conflict', current: null };
  // Step 1: already there — an earlier send succeeded and only its response
  // was lost, or the browser's version never differed.
  if (current.version === sentVersion) return { id, status: 'alreadyApplied' };

  // Step 2: the version check is part of the update's condition.
  const updated = await prisma.note.updateMany({
    where: { id, ...scopeWhere(), version: item.ifVersion },
    data: { ...fields, version: sentVersion },
  });
  if (updated.count === 1) return { id, status: 'applied' };

  // Step 3: it moved on (or was never at ifVersion). Report where it is now.
  const now = await currentEntry(prisma, id);
  if (now?.version === sentVersion) return { id, status: 'alreadyApplied' };
  return { id, status: 'conflict', current: now };
}

/**
 * Resolve each item in turn; one conflict does not stop the rest.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param items - The browser versions chosen by the user / 選ばれた PC の版
 * @returns One outcome per item, in order / 要素ごとの結果
 */
export async function resolveMigrationItems(
  prisma: PrismaInstance,
  items: ResolveItem[],
): Promise<ResolveOutcome[]> {
  const out: ResolveOutcome[] = [];
  for (const item of items) out.push(await resolveMigrationItem(prisma, item));
  return out;
}
