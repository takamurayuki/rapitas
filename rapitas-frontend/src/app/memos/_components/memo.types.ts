/**
 * memo.types
 *
 * Shared types for the lightweight memo feature (/memos page).
 */

/** Memo row as returned by GET /memos. */
export interface Memo {
  id: number;
  content: string;
  remindAt: string | null;
  remindedAt: string | null;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List filter tabs. */
export type MemoFilter = 'open' | 'reminder' | 'done';
