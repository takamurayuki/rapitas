/**
 * note-migration-runner
 *
 * The desktop note migration's steps, in order (design §5.3 steps 2–6):
 * diff against the manifest, import what the server lacks in 500-note
 * chunks, add the links it lacks, then hand the differences to the user and
 * write what they chose. Progress goes to the `note-migration` record after
 * every chunk.
 *
 * Every step is safe to repeat — the import skips ids it has, the link
 * import adds only what is missing, resolve answers `alreadyApplied` for a
 * write that already landed — so a run cut off anywhere is resumed by simply
 * running again from a fresh manifest. Not responsible for the backup file
 * or the screen — see useNoteMigration.
 */
import type { Note } from '@/stores/note/note-types';
import type {
  DiffChoice,
  MigrationRecord,
  RejectedLink,
} from '@/stores/note/note-migration-record';
import type { LinkImportItem, MigrationApi, ResolveItem } from './note-migration-api';
import {
  differingFields,
  planMigration,
  sha256Hex,
  type Hasher,
  type LocalLink,
  type MigrationDiff,
} from './note-migration-plan';

/** `/notes/import` and `/notes/links/import` take at most this many per request. */
export const IMPORT_CHUNK = 500;
/** `/notes/migration/resolve` takes at most this many per request. */
export const RESOLVE_CHUNK = 50;

/** Where the record is read from and written to; injected for tests. */
export interface RecordIo {
  read(): MigrationRecord;
  write(record: MigrationRecord): MigrationRecord;
}

export interface RunDeps {
  api: MigrationApi;
  records: RecordIo;
  localNotes: Note[];
  hash?: Hasher;
  onProgress?: (record: MigrationRecord, total: number) => void;
}

export type RunResult =
  | { status: 'done'; record: MigrationRecord }
  | { status: 'needsDecision'; diffs: MigrationDiff[]; record: MigrationRecord };

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function mergeRejected(existing: RejectedLink[], more: RejectedLink[]): RejectedLink[] {
  const key = (r: RejectedLink) => `${r.noteId}:${r.taskId}`;
  const seen = new Set(existing.map(key));
  return [...existing, ...more.filter((r) => !seen.has(key(r)))];
}

async function sendLinks(deps: RunDeps, links: LocalLink[]): Promise<void> {
  for (const chunk of chunks<LinkImportItem>(links, IMPORT_CHUNK)) {
    const results = await deps.api.importLinks(chunk);
    const rejected = results.flatMap((r) =>
      r.status === 'rejected' ? [{ noteId: r.noteId, taskId: r.taskId, error: r.error }] : [],
    );
    const record = deps.records.read();
    deps.records.write({ ...record, rejectedLinks: mergeRejected(record.rejectedLinks, rejected) });
  }
}

/**
 * Run (or resume) the migration up to the point that needs the user.
 *
 * @param deps - The API, the record, the local notes / API・記録・ローカルのノート
 * @returns done, or the differences to decide / 完了、または判断が要る差異
 * @throws {Error} when no backup was written, or a request failed (the record keeps the progress) / 控えが無いとき、要求が失敗したとき
 */
export async function runMigration(deps: RunDeps): Promise<RunResult> {
  const hash = deps.hash ?? sha256Hex;
  let record = deps.records.read();
  if (!record.backedUpAt) throw new Error('note migration needs a backup first');

  const manifest = await deps.api.fetchManifest();
  const plan = await planMigration(deps.localNotes, manifest, record.resolved, hash);

  record = deps.records.write({ ...record, phase: 'importing', lastError: null });
  const total = plan.toImport.length;
  for (const chunk of chunks(plan.toImport, IMPORT_CHUNK)) {
    const result = await deps.api.importNotes(chunk);
    record = deps.records.write({
      ...record,
      imported: record.imported + result.importedIds.length,
    });
    deps.onProgress?.(record, total);
  }

  record = deps.records.write({ ...record, phase: 'linking' });
  await sendLinks(deps, plan.links);
  record = deps.records.read();

  if (plan.diffs.length > 0) {
    record = deps.records.write({ ...record, phase: 'resolving' });
    return { status: 'needsDecision', diffs: plan.diffs, record };
  }
  record = deps.records.write({ ...record, phase: 'done' });
  return { status: 'done', record };
}

/**
 * Write the user's choices for the differences, then finish if nothing is left.
 *
 * - PC: the conditional resolve. A conflict (the phone edited since the
 *   diff) comes back as a difference against the server's current version.
 * - Server: nothing is sent.
 * - Both: the PC version is imported as `{id}-pc`.
 *
 * @param deps - The API, the record, the local notes / API・記録・ローカルのノート
 * @param diffs - The differences on screen / 画面の差異
 * @param choices - The choice per id / ID ごとの選択
 * @returns done, or the differences that came back as conflicts / 完了、または競合で戻った差異
 */
export async function applyDecisions(
  deps: RunDeps,
  diffs: MigrationDiff[],
  choices: Record<string, DiffChoice>,
): Promise<RunResult> {
  const hash = deps.hash ?? sha256Hex;
  const choiceOf = (d: MigrationDiff): DiffChoice => choices[d.id] ?? d.defaultChoice;
  const settle = (ids: string[], choice: DiffChoice) => {
    const record = deps.records.read();
    const resolved = { ...record.resolved };
    for (const id of ids) resolved[id] = choice;
    deps.records.write({ ...record, resolved });
  };

  settle(
    diffs.filter((d) => choiceOf(d) === 'server').map((d) => d.id),
    'server',
  );

  const both = diffs.filter((d) => choiceOf(d) === 'both');
  for (const chunk of chunks(both, IMPORT_CHUNK)) {
    await deps.api.importNotes(chunk.map((d) => ({ ...d.local, id: `${d.id}-pc` })));
    settle(
      chunk.map((d) => d.id),
      'both',
    );
  }

  const remaining: MigrationDiff[] = [];
  const pc = diffs.filter((d) => choiceOf(d) === 'pc');
  for (const chunk of chunks(pc, RESOLVE_CHUNK)) {
    const items: ResolveItem[] = chunk.map((d) => ({
      id: d.id,
      ifVersion: d.server.version,
      title: d.local.title,
      content: d.local.content,
      tags: d.local.tags,
      docType: d.local.docType,
    }));
    const outcomes = await deps.api.resolve(items);
    const written: string[] = [];
    const gone: MigrationDiff[] = [];
    for (const outcome of outcomes) {
      const diff = chunk.find((d) => d.id === outcome.id);
      if (!diff) continue;
      if (outcome.status !== 'conflict') written.push(diff.id);
      else if (!outcome.current) gone.push(diff);
      else {
        const fields = await differingFields(diff.local, outcome.current, hash);
        if (fields.length === 0) written.push(diff.id);
        else remaining.push({ ...diff, server: outcome.current, fields });
      }
    }
    // Deleted on the server since the diff: the PC version goes back in
    // under its own id, links and all.
    if (gone.length > 0) {
      await deps.api.importNotes(gone.map((d) => d.local));
      const ids = new Set(gone.map((d) => d.id));
      await sendLinks(
        deps,
        deps.localNotes.flatMap((n) =>
          ids.has(n.id)
            ? (n.linkedTaskIds ?? []).map((taskId) => {
                const meta = n.linkedTaskMeta?.[taskId];
                return { noteId: n.id, taskId, ...(meta ? { meta } : {}) };
              })
            : [],
        ),
      );
      written.push(...ids);
    }
    settle(written, 'pc');
  }

  let record = deps.records.read();
  if (remaining.length > 0) return { status: 'needsDecision', diffs: remaining, record };
  record = deps.records.write({ ...record, phase: 'done' });
  return { status: 'done', record };
}
