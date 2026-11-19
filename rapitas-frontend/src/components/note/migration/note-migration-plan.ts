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
import type { DiffChoice, ResolvedDiff } from '@/stores/note/note-migration-record';
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
  /**
   * "Keep both" cannot be done: `{id}-pc` already exists with other content,
   * or another workspace holds that id. Offered only as PC / server then.
   */
  copyUnavailable: boolean;
  /**
   * The server version of `{id}-pc` when it is this browser's own copy of an
   * older PC version, untouched since; "keep both" replaces it. Otherwise null.
   */
  staleCopyVersion: string | null;
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
 * A fingerprint of a local note's four compared fields, recorded with a
 * choice so a later edit of the PC note un-settles it.
 *
 * @param local - The normalized local note / 正規化したローカルのノート
 * @param hash - SHA-256 / ハッシュ関数
 * @returns The fingerprint / 指紋
 */
export function localVersionOf(local: NormalizedNote, hash: Hasher): Promise<string> {
  return hash(JSON.stringify([local.title, local.content, local.tags, local.docType]));
}

/** The id "keep both" imports the PC version under (design §5.3 step 3). */
export const copyIdOf = (id: string) => `${id}-pc`;

/**
 * The four compared fields of a server note, as the manifest lists them.
 *
 * @param entry - The manifest entry / 版情報
 * @returns A comparable signature / 比較用の署名
 */
export function manifestSignatureOf(entry: ManifestEntry): string {
  return JSON.stringify([entry.title, entry.contentSha256, entry.tags, entry.docType ?? null]);
}

/**
 * The signature the server's copy has once `local` is stored as it; equal to
 * `manifestSignatureOf` of that copy while no one has edited it.
 *
 * @param local - The PC version to copy / 写しにする PC 版
 * @param hash - SHA-256, the same as the server's / ハッシュ関数
 * @returns A comparable signature / 比較用の署名
 */
export async function copySignatureOf(local: NormalizedNote, hash: Hasher): Promise<string> {
  return JSON.stringify([local.title, await hash(local.content), local.tags, local.docType]);
}

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
 * A difference counts as settled — and is not listed — when the user chose
 * for exactly this PC version (`resolved`, matched by fingerprint), or when
 * the server already has the `{id}-pc` copy with this PC version's content
 * (a "keep both" whose response was lost).
 *
 * @param localNotes - The browser's notes / ブラウザのノート
 * @param manifest - The server's manifest / サーバーの版情報
 * @param resolved - Differences the user already settled / 解決済みの差異
 * @param hash - SHA-256 / ハッシュ関数
 * @param blockedCopies - Ids whose copy another workspace holds / 写しのIDを別区画が持つID
 * @param ownCopies - Signatures of the copies this browser wrote / このブラウザが書いた写しの署名
 * @param pendingCopies - Signatures of copy writes whose outcome was lost / 応答が失われた写しの署名（候補）
 * @returns What to import, what differs, and the links / 取り込み・差異・紐付け
 */
export async function planMigration(
  localNotes: Note[],
  manifest: ManifestEntry[],
  resolved: Record<string, ResolvedDiff>,
  hash: Hasher = sha256Hex,
  blockedCopies: string[] = [],
  ownCopies: Record<string, string> = {},
  pendingCopies: Record<string, string> = {},
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
    if (fields.length === 0 || (await isSettled(local, resolved[note.id], hash))) {
      plan.unchanged.push(note.id);
      continue;
    }
    const copy = byId.get(copyIdOf(note.id));
    if (copy && (await differingFields(local, copy, hash)).length === 0) {
      plan.unchanged.push(note.id);
      continue;
    }
    // NOTE: an untouched copy this browser wrote for an older PC version is
    // not "other content" — it would otherwise lock "both" out for the edit.
    // NOTE: a candidate (a write whose response was lost) counts only when the
    // copy has exactly the content this browser sent (re-review 3).
    const ownStale =
      !!copy &&
      (ownCopies[note.id] === manifestSignatureOf(copy) ||
        pendingCopies[note.id] === manifestSignatureOf(copy));
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
      copyUnavailable: (!!copy && !ownStale) || blockedCopies.includes(note.id),
      staleCopyVersion: ownStale && copy ? copy.version : null,
    });
  }
  return plan;
}

/**
 * The candidates still worth keeping: those whose `{id}-pc` on the server has
 * exactly the signature that was sent. A missing or different copy means the
 * lost write never landed or was changed since, so the candidate is dropped.
 *
 * @param pendingCopies - Signatures of copy writes whose outcome was lost / 応答が失われた写しの署名
 * @param manifest - The server's manifest / サーバーの版情報
 * @returns The candidates that match / 一致する候補
 */
export function matchingPendingCopies(
  pendingCopies: Record<string, string>,
  manifest: ManifestEntry[],
): Record<string, string> {
  const byId = new Map(manifest.map((m) => [m.id, m]));
  return Object.fromEntries(
    Object.entries(pendingCopies).filter(([id, signature]) => {
      const copy = byId.get(copyIdOf(id));
      return !!copy && manifestSignatureOf(copy) === signature;
    }),
  );
}

async function isSettled(
  local: NormalizedNote,
  settled: ResolvedDiff | undefined,
  hash: Hasher,
): Promise<boolean> {
  // A record from before choices carried a fingerprint is a bare string; it
  // does not say which PC version it covered, so the difference is asked again.
  if (!settled || typeof settled !== 'object') return false;
  return settled.localVersion === (await localVersionOf(local, hash));
}
