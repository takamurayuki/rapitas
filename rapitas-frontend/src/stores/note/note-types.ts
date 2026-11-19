/**
 * note-types
 *
 * The note shapes the desktop store, the API client and the migration share.
 * Not responsible for any state — see `note-store.ts`.
 */

/**
 * Per-task context stored on a note-task link.
 *
 * NOTE: every key is optional since stage 0: the server is the source now,
 * and a link the phone made carries `themeName` / `projectName` /
 * `parentTaskTitle` while one made here carries `taskTitle` / `themeName` /
 * `categoryName`. The server accepts all five (design §5.1).
 */
export interface NoteTaskMeta {
  taskTitle?: string;
  themeName?: string;
  categoryName?: string;
  projectName?: string;
  parentTaskTitle?: string;
}

export const DOC_TYPES = ['要件定義', '設計書', '議事録', '手順書', '仕様書', 'メモ'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;
  tags: string[];
  color?: string;
  /** Document type for organizing design/requirements docs / 要件定義・設計書などの種別 */
  docType?: DocType;
  /** Task IDs this note is linked to. */
  linkedTaskIds?: number[];
  /** Hierarchy metadata keyed by taskId — populated when linking from a task context. */
  linkedTaskMeta?: Record<number, NoteTaskMeta>;
}

/**
 * Where the store reads and writes.
 *
 * `local` is the pre-migration browser store (localStorage `note-storage`),
 * kept only until this browser's notes have been moved; `server` is the API.
 */
export type NoteSource = 'local' | 'server';

/** The fields a save may send. */
export type NoteUpdate = Partial<
  Pick<Note, 'title' | 'content' | 'isPinned' | 'tags' | 'color' | 'docType'>
>;
