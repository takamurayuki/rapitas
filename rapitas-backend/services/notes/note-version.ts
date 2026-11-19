/**
 * NoteVersion
 *
 * The version a note's four compared fields (title, content, tags, docType)
 * hash to, and the content hash the migration manifest carries instead of the
 * body. Pure: no Prisma, no clock.
 *
 * The server is the only party that computes `version`; clients compare the
 * fields themselves and send back the version they were shown (`ifVersion`).
 * Not responsible for writing it — see note-write.
 */
import { createHash } from 'node:crypto';

/** The four fields `version` covers, in their stored form. */
export interface NoteVersionFields {
  title: string;
  content: string;
  /** The `tags` column as stored: a JSON array in a string. */
  tags: string;
  docType: string | null;
}

/** Read the stored tags column back into an array; a bad row hashes as no tags. */
function readTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The version of a note's compared fields.
 *
 * NOTE: the shape is fixed by design §5.3 — keys in this order, tags re-read
 * from the JSON column, a missing docType as null, strings exactly as stored
 * (no NFC normalisation). Changing any of it silently turns every stored
 * version into a mismatch, so a change here needs a re-backfill.
 *
 * @param fields - The stored title, content, tags column and docType / 保存されている4項目
 * @returns Hex SHA-256 / 16進の SHA-256
 */
export function computeNoteVersion(fields: NoteVersionFields): string {
  const canonical = JSON.stringify({
    title: fields.title,
    content: fields.content,
    tags: readTags(fields.tags),
    docType: fields.docType ?? null,
  });
  return sha256(canonical);
}

/**
 * SHA-256 of a note body, so the manifest can be compared without the body.
 *
 * @param content - The note body / ノート本文
 * @returns Hex SHA-256 of the UTF-8 bytes / UTF-8 バイト列の16進 SHA-256
 */
export function computeContentSha256(content: string): string {
  return sha256(content);
}
