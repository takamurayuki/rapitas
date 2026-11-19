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
 * running again from a fresh manifest.
 *
 * NOTE: the PC notes stay editable until the store switches to the server
 * (the page keeps the local view while migrating, design §5.3 step 7), so a
 * run never trusts the notes it started from. It finishes only after a pass
 * that found nothing left to send AND saw the local notes unchanged from
 * that pass's start; `onComplete` runs in the same synchronous step, before
 * any later edit can land locally. A note created or edited meanwhile is
 * therefore either sent by a further pass or listed again as a difference.
 *
 * Not responsible for the backup file or the screen — see useNoteMigration.
 */
import type { Note } from '@/stores/note/note-types';
import type {
  DiffChoice,
  MigrationRecord,
  RejectedLink,
} from '@/stores/note/note-migration-record';
import type { LinkImportItem, MigrationApi, ResolveItem } from './note-migration-api';
import { writeCopies } from './note-migration-copy';
import {
  localVersionOf,
  matchingPendingCopies,
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
/** Passes a run makes while the local notes keep changing under it. */
export const MAX_PASSES = 5;

/** Where the record is read from and written to; injected for tests. */
export interface RecordIo {
  read(): MigrationRecord;
  write(record: MigrationRecord): MigrationRecord;
}

export interface RunDeps {
  api: MigrationApi;
  records: RecordIo;
  /** The browser's notes, read again on every pass — they can change mid-run. */
  readLocal: () => Note[];
  hash?: Hasher;
  onProgress?: (record: MigrationRecord, total: number) => void;
  /**
   * Called synchronously the moment the run is complete, so the caller can
   * switch the store to the server before any further local edit.
   */
  onComplete?: () => void;
}

/** A local note the server cannot take: another workspace holds its id. */
export interface BlockedNote {
  id: string;
  title: string;
}

export type RunResult =
  | { status: 'done'; record: MigrationRecord }
  | {
      status: 'needsDecision';
      diffs: MigrationDiff[];
      /** Not migrated and not resolvable here; the migration stays unfinished. */
      blocked: BlockedNote[];
      record: MigrationRecord;
    };

/** The local notes kept changing through every pass; nothing is lost, run again. */
export class LocalNotesChangingError extends Error {
  constructor() {
    super('note migration: the PC notes kept changing; run again');
    this.name = 'LocalNotesChangingError';
  }
}

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
 * @returns done, or the differences to decide and the notes that cannot move / 完了、または判断が要る差異と移せないノート
 * @throws {LocalNotesChangingError} when the local notes changed through every pass / すべての周回でローカルが変わったとき
 * @throws {Error} when no backup was written, or a request failed (the record keeps the progress) / 控えが無いとき、要求が失敗したとき
 */
export async function runMigration(deps: RunDeps): Promise<RunResult> {
  const hash = deps.hash ?? sha256Hex;
  let record = deps.records.read();
  if (!record.backedUpAt) throw new Error('note migration needs a backup first');

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const localNotes = deps.readLocal();
    const startedFrom = JSON.stringify(localNotes);
    const manifest = await deps.api.fetchManifest();
    // A candidate whose copy is absent or differs is settled as not landed /
    // not ours, so it can never match a later copy by someone else.
    const pendingCopies = matchingPendingCopies(record.pendingCopies, manifest);
    const plan = await planMigration(
      localNotes,
      manifest,
      record.resolved,
      hash,
      record.blockedCopies,
      record.ownCopies,
      pendingCopies,
    );

    record = deps.records.write({
      ...record,
      pendingCopies,
      phase: 'importing',
      lastError: null,
    });
    const total = plan.toImport.length;
    const blockedIds = new Set<string>();
    for (const chunk of chunks(plan.toImport, IMPORT_CHUNK)) {
      const result = await deps.api.importNotes(chunk);
      for (const id of result.conflictIds) blockedIds.add(id);
      record = deps.records.write({
        ...record,
        imported: record.imported + result.importedIds.length,
      });
      deps.onProgress?.(record, total);
    }

    record = deps.records.write({ ...record, phase: 'linking' });
    // A blocked note is not on the server; its links would only come back 404.
    await sendLinks(
      deps,
      plan.links.filter((l) => !blockedIds.has(l.noteId)),
    );
    record = deps.records.read();

    if (plan.diffs.length > 0 || blockedIds.size > 0) {
      record = deps.records.write({ ...record, phase: 'resolving' });
      const blocked = plan.toImport
        .filter((n) => blockedIds.has(n.id))
        .map((n) => ({ id: n.id, title: n.title }));
      return { status: 'needsDecision', diffs: plan.diffs, blocked, record };
    }
    // Synchronous from this check to onComplete: no local edit can slip in.
    if (JSON.stringify(deps.readLocal()) === startedFrom) {
      // Candidates only mean anything while this migration can resume.
      record = deps.records.write({ ...record, phase: 'done', pendingCopies: {} });
      deps.onComplete?.();
      return { status: 'done', record };
    }
  }
  throw new LocalNotesChangingError();
}

/**
 * Write the user's choices for the differences, then check everything again.
 *
 * - PC: the conditional resolve. A conflict (the phone edited since the
 *   diff) is not settled, so the check after lists it again against the
 *   server's current version; a note deleted on the server is imported again.
 * - Server: nothing is sent.
 * - Both: the PC version is imported as `{id}-pc` (see writeCopies). It is
 *   settled only by the server holding a copy with this content (see
 *   planMigration), so a copy id already taken by other content is listed
 *   again with "both" unavailable.
 *
 * Each choice is recorded for the PC version shown; if the PC note was
 * edited after the list was shown, the check after lists it again — and
 * "both" writes no copy of the superseded version.
 *
 * @param deps - The API, the record, the local notes / API・記録・ローカルのノート
 * @param diffs - The differences on screen / 画面の差異
 * @param choices - The choice per id / ID ごとの選択
 * @returns done, or what is still to decide / 完了、または残りの判断
 */
export async function applyDecisions(
  deps: RunDeps,
  diffs: MigrationDiff[],
  choices: Record<string, DiffChoice>,
): Promise<RunResult> {
  const hash = deps.hash ?? sha256Hex;
  const choiceOf = (d: MigrationDiff): DiffChoice => {
    const choice = choices[d.id] ?? d.defaultChoice;
    return choice === 'both' && d.copyUnavailable ? d.defaultChoice : choice;
  };
  const settle = async (settled: MigrationDiff[], choice: DiffChoice) => {
    const entries = await Promise.all(
      settled.map(async (d) => [
        d.id,
        { choice, localVersion: await localVersionOf(d.local, hash) },
      ]),
    );
    const record = deps.records.read();
    deps.records.write({
      ...record,
      resolved: { ...record.resolved, ...Object.fromEntries(entries) },
    });
  };

  await settle(
    diffs.filter((d) => choiceOf(d) === 'server'),
    'server',
  );

  await writeCopies(
    deps,
    diffs.filter((d) => choiceOf(d) === 'both'),
    hash,
    { importChunk: IMPORT_CHUNK, resolveChunk: RESOLVE_CHUNK },
  );

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
    const written = new Set(outcomes.filter((o) => o.status !== 'conflict').map((o) => o.id));
    await settle(
      chunk.filter((d) => written.has(d.id)),
      'pc',
    );
  }

  return runMigration(deps);
}
