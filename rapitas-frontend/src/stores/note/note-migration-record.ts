/**
 * note-migration-record
 *
 * How far this browser's note migration has got, in localStorage
 * `note-migration` (design §5.3 step 6), so a migration cut off by a closed
 * window or a failed request resumes where it stopped the next time the
 * notes page opens. Every step it records is safe to repeat, so the record
 * only has to be good enough to skip work, never to avoid doing it twice.
 *
 * Not responsible for running the steps — see components/note/migration.
 */

export const NOTE_MIGRATION_KEY = 'note-migration';

/** The steps, in order. `done` switches the store to the server. */
export type MigrationPhase = 'notStarted' | 'importing' | 'linking' | 'resolving' | 'done';

/** What the user chose for one difference. */
export type DiffChoice = 'pc' | 'server' | 'both';

/**
 * A settled difference: the choice, and the PC version it was made for.
 *
 * NOTE: the PC note can still change until the store switches to the server
 * (the page keeps the local view meanwhile). A choice only covers the
 * version the user saw; once the local note moves on, the difference is
 * asked again rather than silently treated as settled.
 */
export interface ResolvedDiff {
  choice: DiffChoice;
  /** `localVersionOf` the PC note when the choice was made. */
  localVersion: string;
}

/** A link the server would not take, kept so it can be shown. */
export interface RejectedLink {
  noteId: string;
  taskId: number;
  error: string;
}

export interface MigrationRecord {
  phase: MigrationPhase;
  /** When the JSON backup was written; the migration does not start without one. */
  backedUpAt: string | null;
  /** Notes taken in so far (progress only). */
  imported: number;
  /** Differences already settled, so a resume does not ask again. */
  resolved: Record<string, ResolvedDiff>;
  /** Ids whose `{id}-pc` copy another workspace holds, so "keep both" cannot be offered. */
  blockedCopies: string[];
  rejectedLinks: RejectedLink[];
  /** The last failure, shown with a retry. */
  lastError: string | null;
  updatedAt: string;
}

export const INITIAL_RECORD: MigrationRecord = {
  phase: 'notStarted',
  backedUpAt: null,
  imported: 0,
  resolved: {},
  blockedCopies: [],
  rejectedLinks: [],
  lastError: null,
  updatedAt: new Date(0).toISOString(),
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The saved record, or the initial one.
 *
 * @returns The migration record / 移行の記録
 */
export function readMigrationRecord(): MigrationRecord {
  const raw = storage()?.getItem(NOTE_MIGRATION_KEY);
  if (!raw) return { ...INITIAL_RECORD };
  try {
    return { ...INITIAL_RECORD, ...(JSON.parse(raw) as Partial<MigrationRecord>) };
  } catch {
    return { ...INITIAL_RECORD };
  }
}

/**
 * Save the record.
 *
 * @param record - The record to save / 保存する記録
 * @returns The saved record with its timestamp / 時刻付きの記録
 */
export function writeMigrationRecord(record: MigrationRecord): MigrationRecord {
  const next = { ...record, updatedAt: new Date().toISOString() };
  try {
    storage()?.setItem(NOTE_MIGRATION_KEY, JSON.stringify(next));
  } catch {
    // A record that cannot be saved only means more repeated (idempotent) work.
  }
  return next;
}

/**
 * Whether this browser is past the migration.
 *
 * @returns true once the record says done / 完了していれば true
 */
export function isNoteMigrationDone(): boolean {
  return readMigrationRecord().phase === 'done';
}
