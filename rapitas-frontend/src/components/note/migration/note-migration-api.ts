/**
 * note-migration-api
 *
 * The four server calls the desktop's note migration makes, behind an
 * interface so the runner can be tested against an in-memory server.
 * Not responsible for ordering them — see note-migration-runner.
 */
import { API_BASE_URL } from '@/utils/api';
import type { NoteTaskMeta } from '@/stores/note/note-types';
import type { ManifestEntry, NormalizedNote } from './note-migration-plan';

/** The PC version of a note the server has, with the version it was diffed against. */
export interface ResolveItem {
  id: string;
  ifVersion: string;
  title: string;
  content: string;
  tags: string[];
  docType: string | null;
}

export type ResolveOutcome =
  | { id: string; status: 'applied' | 'alreadyApplied' }
  | { id: string; status: 'conflict'; current: ManifestEntry | null };

export interface LinkImportItem {
  noteId: string;
  taskId: number;
  meta?: NoteTaskMeta;
}

export type LinkImportResult =
  | { noteId: string; taskId: number; status: 'added' | 'filled' | 'unchanged' }
  | { noteId: string; taskId: number; status: 'rejected'; code: number; error: string };

/**
 * What `/notes/import` did per id. `skippedIds` are already in this
 * workspace (idempotent); `conflictIds` are held by another workspace and
 * were NOT stored — resending will not change that.
 */
export interface ImportOutcome {
  importedIds: string[];
  skippedIds: string[];
  conflictIds: string[];
}

export interface MigrationApi {
  fetchManifest(): Promise<ManifestEntry[]>;
  importNotes(notes: NormalizedNote[]): Promise<ImportOutcome>;
  resolve(items: ResolveItem[]): Promise<ResolveOutcome[]>;
  importLinks(links: LinkImportItem[]): Promise<LinkImportResult[]>;
}

/** A migration request the server refused or never answered. */
export class MigrationRequestError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
  ) {
    super(`note migration ${step} failed: HTTP ${status}`);
    this.name = 'MigrationRequestError';
  }
}

async function call<T>(step: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new MigrationRequestError(step, res.status);
  return (await res.json()) as T;
}

/** The migration calls against the real API. */
export const httpMigrationApi: MigrationApi = {
  async fetchManifest() {
    const body = await call<{ notes: ManifestEntry[] }>('manifest', '/notes/migration/manifest');
    return body.notes;
  },
  async importNotes(notes) {
    const body = await call<Partial<ImportOutcome>>('import', '/notes/import', { notes });
    return {
      importedIds: body.importedIds ?? [],
      skippedIds: body.skippedIds ?? [],
      conflictIds: body.conflictIds ?? [],
    };
  },
  async resolve(items) {
    const body = await call<{ results: ResolveOutcome[] }>('resolve', '/notes/migration/resolve', {
      items,
    });
    return body.results;
  },
  async importLinks(links) {
    const body = await call<{ results: LinkImportResult[] }>('links', '/notes/links/import', {
      links,
    });
    return body.results;
  },
};
