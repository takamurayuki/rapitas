/**
 * note-migration-plan
 *
 * Pure diffing for the desktop's note migration (design §5.3 step 2): each
 * local note against the server's body-free manifest, by all four compared
 * fields (title, body hash, tags, type). Not responsible for sending
 * anything — see note-migration-runner.
 */
import type { Note, NoteTaskMeta } from '@/stores/note/note-types';
import { isMeaningfulNote } from '@/stores/note/note-local-backup';
import type { DiffChoice } from '@/stores/note/note-migration-record';
import { isLegacyEditorHtml } from '../markdown-note/note-content-kind';

/** One server note as the manifest lists it. */
export interface ManifestEntry {
  id: string;
  updatedAt: string;
  version: string;
  title: string;
  tags: string[];
  docType: string | null;
  contentSha256: string;
  linkedTaskIds: number[];
}

/** A compared field that differs. */
export type DiffField = 'title' | 'content' | 'tags' | 'docType';

/** A local note in the form the server stores, so the comparison is fair. */
export interface NormalizedNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  docType: string | null;
  isPinned: boolean;
}

/** A note both sides have, with different content. */
export interface MigrationDiff {
  id: string;
  local: NormalizedNote;
  localUpdatedAt: string;
  server: ManifestEntry;
  fields: DiffField[];
  defaultChoice: Exclude<DiffChoice, 'both'>;
  /** The PC version is the old editor's HTML; it stays read-only once moved. */
  localIsLegacyHtml: boolean;
}

/** One link the browser had. */
export interface LocalLink {
  noteId: string;
  taskId: number;
  meta?: NoteTaskMeta;
}

export interface MigrationPlan {
  toImport: NormalizedNote[];
  unchanged: string[];
  diffs: MigrationDiff[];
  links: LocalLink[];
  /** Blank notes the old store made on its own; not moved. */
  skippedBlank: number;
}

/** Hex SHA-256 of a string's UTF-8 bytes; injected so tests need no WebCrypto. */
export type Hasher = (text: string) => Promise<string>;

/**
 * SHA-256 with WebCrypto, matching the server's `contentSha256`.
 *
 * @param text - The text to hash / ハッシュする文字列
 * @returns Hex digest / 16進のダイジェスト
 */
export const sha256Hex: Hasher = async (text) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

// The server's caps (note-limits.ts); applied here so a long local note is
// compared and sent exactly as the server would store it.
const MAX_TITLE = 300;
const MAX_CONTENT = 200_000;
const MAX_TAGS = 30;

/**
 * A local note trimmed and bounded the way the server stores it.
 *
 * @param note - The local note / ローカルのノート
 * @returns Its stored form / 保存される形
 */
export function normalizeLocalNote(note: Note): NormalizedNote {
  return {
    id: note.id,
    title: (note.title ?? '').slice(0, MAX_TITLE),
    content: (note.content ?? '').slice(0, MAX_CONTENT),
    tags: (note.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, MAX_TAGS),
    docType: note.docType ?? null,
    isPinned: !!note.isPinned,
  };
}

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((tag, i) => tag === b[i]);

/**
 * Which compared fields differ between a local note and its manifest entry.
 *
 * @param local - The normalized local note / 正規化したローカルのノート
 * @param server - The manifest entry / 版情報
 * @param hash - SHA-256 / ハッシュ関数
 * @returns The differing fields / 違う項目
 */
export async function differingFields(
  local: NormalizedNote,
  server: ManifestEntry,
  hash: Hasher,
): Promise<DiffField[]> {
  const fields: DiffField[] = [];
  if (local.title !== server.title) fields.push('title');
  if ((await hash(local.content)) !== server.contentSha256) fields.push('content');
  if (!sameTags(local.tags, server.tags)) fields.push('tags');
  if (local.docType !== (server.docType ?? null)) fields.push('docType');
  return fields;
}

function toDate(value: Date | string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Classify every local note, and gather every local link.
 *
 * @param localNotes - The browser's notes / ブラウザのノート
 * @param manifest - The server's manifest / サーバーの版情報
 * @param resolved - Differences the user already settled / 解決済みの差異
 * @param hash - SHA-256 / ハッシュ関数
 * @returns What to import, what differs, and the links / 取り込み・差異・紐付け
 */
export async function planMigration(
  localNotes: Note[],
  manifest: ManifestEntry[],
  resolved: Record<string, DiffChoice>,
  hash: Hasher = sha256Hex,
): Promise<MigrationPlan> {
  const byId = new Map(manifest.map((m) => [m.id, m]));
  const plan: MigrationPlan = {
    toImport: [],
    unchanged: [],
    diffs: [],
    links: [],
    skippedBlank: 0,
  };
  for (const note of localNotes) {
    if (!isMeaningfulNote(note)) {
      plan.skippedBlank += 1;
      continue;
    }
    const local = normalizeLocalNote(note);
    for (const taskId of note.linkedTaskIds ?? []) {
      const meta = note.linkedTaskMeta?.[taskId];
      plan.links.push({ noteId: note.id, taskId, ...(meta ? { meta } : {}) });
    }
    const server = byId.get(note.id);
    if (!server) {
      plan.toImport.push(local);
      continue;
    }
    const fields = await differingFields(local, server, hash);
    if (fields.length === 0 || resolved[note.id]) {
      plan.unchanged.push(note.id);
      continue;
    }
    const localUpdatedAt = new Date(note.updatedAt).toISOString();
    plan.diffs.push({
      id: note.id,
      local,
      localUpdatedAt,
      server,
      fields,
      // The initial choice is whichever side was updated more recently.
      defaultChoice: toDate(note.updatedAt) > toDate(server.updatedAt) ? 'pc' : 'server',
      localIsLegacyHtml: isLegacyEditorHtml(local.content),
    });
  }
  return plan;
}
