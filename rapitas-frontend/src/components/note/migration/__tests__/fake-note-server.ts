/**
 * fake-note-server
 *
 * An in-memory server for the migration runner's tests, with the backend's
 * semantics (services/notes/note-write, note-migration, note-links): the
 * import skips known ids, resolve checks the sent version first and then
 * writes only under `version = ifVersion`, the link import adds missing
 * links and fills only empty meta keys, and a task outside the workspace is
 * a per-link 404. Ids in `foreign` stand for notes another workspace holds:
 * invisible to the manifest, and an import of them is a conflict. `failNext` makes the next call throw — before or after it
 * took effect — to stand in for a cut connection or a lost response.
 */
import type { NoteTaskMeta } from '@/stores/note/note-types';
import type { LinkImportResult, MigrationApi, ResolveOutcome } from '../note-migration-api';
import type { ManifestEntry, NormalizedNote } from '../note-migration-plan';

export interface FakeNote {
  title: string;
  content: string;
  tags: string[];
  docType: string | null;
  updatedAt: string;
}

/** The test hash: readable, and the same function the runner is given. */
export const fakeHash = async (text: string) => `h:${text}`;

const versionOf = (n: FakeNote) =>
  JSON.stringify({ title: n.title, content: n.content, tags: n.tags, docType: n.docType });

type Method = 'fetchManifest' | 'importNotes' | 'resolve' | 'importLinks';

export function createFakeNoteServer(inScopeTasks: number[] = [7, 8]) {
  const notes = new Map<string, FakeNote>();
  const links = new Map<string, NoteTaskMeta>();
  const foreign = new Set<string>();
  const calls: Record<Method, number> = {
    fetchManifest: 0,
    importNotes: 0,
    resolve: 0,
    importLinks: 0,
  };
  let creates = 0;
  let failure: { method: Method; when: 'before' | 'after' } | null = null;
  let clock = Date.parse('2026-11-10T00:00:00Z');
  const now = () => new Date((clock += 1000)).toISOString();

  const fail = async <T>(method: Method, run: () => Promise<T>): Promise<T> => {
    calls[method] += 1;
    if (failure?.method === method && failure.when === 'before') {
      failure = null;
      throw new Error(`${method}: connection cut`);
    }
    const result = await run();
    if (failure?.method === method && failure.when === 'after') {
      failure = null;
      throw new Error(`${method}: response lost`);
    }
    return result;
  };

  const entry = (id: string, n: FakeNote): ManifestEntry => ({
    id,
    updatedAt: n.updatedAt,
    version: versionOf(n),
    title: n.title,
    tags: n.tags,
    docType: n.docType,
    contentSha256: `h:${n.content}`,
    linkedTaskIds: [...links.keys()]
      .filter((k) => k.startsWith(`${id}:`))
      .map((k) => Number(k.split(':')[1])),
  });

  const api: MigrationApi = {
    fetchManifest: () =>
      fail('fetchManifest', async () => [...notes].map(([id, n]) => entry(id, n))),

    importNotes: (batch: NormalizedNote[]) =>
      fail('importNotes', async () => {
        const importedIds: string[] = [];
        const skippedIds: string[] = [];
        const conflictIds: string[] = [];
        for (const n of batch) {
          if (foreign.has(n.id)) {
            conflictIds.push(n.id);
            continue;
          }
          if (notes.has(n.id)) {
            skippedIds.push(n.id);
            continue;
          }
          creates += 1;
          notes.set(n.id, { ...n, updatedAt: now() });
          importedIds.push(n.id);
        }
        return { importedIds, skippedIds, conflictIds };
      }),

    resolve: (items) =>
      fail('resolve', async () =>
        items.map((item): ResolveOutcome => {
          const sent: FakeNote = { ...item, updatedAt: '' };
          const current = notes.get(item.id);
          if (!current) return { id: item.id, status: 'conflict', current: null };
          if (versionOf(current) === versionOf(sent))
            return { id: item.id, status: 'alreadyApplied' };
          if (versionOf(current) !== item.ifVersion) {
            return { id: item.id, status: 'conflict', current: entry(item.id, current) };
          }
          notes.set(item.id, { ...sent, updatedAt: now() });
          return { id: item.id, status: 'applied' };
        }),
      ),

    importLinks: (batch) =>
      fail('importLinks', async () =>
        batch.map((l): LinkImportResult => {
          if (!notes.has(l.noteId)) {
            return { ...l, status: 'rejected', code: 404, error: 'note_not_found' };
          }
          if (!inScopeTasks.includes(l.taskId)) {
            return {
              noteId: l.noteId,
              taskId: l.taskId,
              status: 'rejected',
              code: 404,
              error: 'task_not_found',
            };
          }
          const key = `${l.noteId}:${l.taskId}`;
          const existing = links.get(key);
          if (!existing) {
            links.set(key, { ...(l.meta ?? {}) });
            return { noteId: l.noteId, taskId: l.taskId, status: 'added' };
          }
          let changed = false;
          const merged: NoteTaskMeta = { ...existing };
          for (const [k, v] of Object.entries(l.meta ?? {}) as [keyof NoteTaskMeta, string][]) {
            if (!merged[k] && v) {
              merged[k] = v;
              changed = true;
            }
          }
          links.set(key, merged);
          return { noteId: l.noteId, taskId: l.taskId, status: changed ? 'filled' : 'unchanged' };
        }),
      ),
  };

  return {
    api,
    notes,
    links,
    foreign,
    calls,
    get creates() {
      return creates;
    },
    failNext(method: Method, when: 'before' | 'after' = 'before') {
      failure = { method, when };
    },
    /** A write that did not come from the migration (the phone, a chat save). */
    put(id: string, fields: Partial<FakeNote>) {
      const base = notes.get(id) ?? {
        title: '',
        content: '',
        tags: [],
        docType: null,
        updatedAt: '',
      };
      notes.set(id, { ...base, ...fields, updatedAt: now() });
    },
  };
}
