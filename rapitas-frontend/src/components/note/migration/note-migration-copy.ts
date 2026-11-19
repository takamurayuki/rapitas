/**
 * note-migration-copy
 *
 * The "keep both" write of the desktop note migration (design §5.3 step 3):
 * the PC version goes to the server as `{id}-pc` next to the server's own.
 * Not responsible for deciding which differences chose "both" — see
 * note-migration-runner.
 *
 * NOTE: the PC note stays editable until the store switches to the server,
 * so the version the user saw may be gone by the time the choice is applied.
 * Two rules keep an old version from taking `{id}-pc` for good:
 * - a choice is applied only while the PC note is still the shown version;
 *   otherwise nothing is written and the next pass lists it again;
 * - a copy this browser wrote (recorded in `ownCopies` by its four compared
 *   fields) that no one has touched since is this run's own older copy, and
 *   "both" replaces it in place with the newer PC version.
 */
import type { MigrationRecord } from '@/stores/note/note-migration-record';
import type { Note } from '@/stores/note/note-types';
import type { MigrationApi, ResolveItem } from './note-migration-api';
import {
  copyIdOf,
  copySignatureOf,
  localVersionOf,
  normalizeLocalNote,
  type Hasher,
  type MigrationDiff,
} from './note-migration-plan';

/** What writing the copies needs; a subset of the runner's dependencies. */
export interface CopyDeps {
  api: MigrationApi;
  records: { read(): MigrationRecord; write(record: MigrationRecord): MigrationRecord };
  readLocal: () => Note[];
}

async function stillShown(
  diffs: MigrationDiff[],
  readLocal: () => Note[],
  hash: Hasher,
): Promise<MigrationDiff[]> {
  const current = new Map(readLocal().map((n) => [n.id, normalizeLocalNote(n)]));
  const kept: MigrationDiff[] = [];
  for (const d of diffs) {
    const now = current.get(d.id);
    if (!now) continue;
    if ((await localVersionOf(now, hash)) === (await localVersionOf(d.local, hash))) kept.push(d);
  }
  return kept;
}

/**
 * Write `{id}-pc` for each "both" whose PC note is still the shown version:
 * a new copy by import, or this browser's own older copy replaced in place.
 *
 * A copy id another workspace holds goes to `blockedCopies`. A replacement
 * that meets a copy edited meanwhile writes nothing; the next pass then finds
 * a copy that is no longer this browser's and offers PC / server only.
 *
 * @param deps - The API, the record, the local notes / API・記録・ローカルのノート
 * @param both - The differences that chose "both" / 「両方残す」を選んだ差異
 * @param hash - SHA-256 / ハッシュ関数
 * @param limits - Items per import / resolve request / 1回の取り込み・解決の件数
 * @throws {Error} when a request failed / 要求が失敗したとき
 */
export async function writeCopies(
  deps: CopyDeps,
  both: MigrationDiff[],
  hash: Hasher,
  limits: { importChunk: number; resolveChunk: number },
): Promise<void> {
  const ready = await stillShown(both, deps.readLocal, hash);
  if (ready.length === 0) return;

  // Recorded before sending, so a copy whose response is lost is still known
  // as this browser's. A copy that ends up with other content (taken first by
  // someone else) simply does not match the signature.
  const signatures = await Promise.all(
    ready.map(async (d) => [d.id, await copySignatureOf(d.local, hash)] as const),
  );
  const before = deps.records.read();
  deps.records.write({
    ...before,
    ownCopies: { ...before.ownCopies, ...Object.fromEntries(signatures) },
  });

  const fresh = ready.filter((d) => d.staleCopyVersion === null);
  for (let i = 0; i < fresh.length; i += limits.importChunk) {
    const chunk = fresh.slice(i, i + limits.importChunk);
    const result = await deps.api.importNotes(
      chunk.map((d) => ({ ...d.local, id: copyIdOf(d.id) })),
    );
    const held = chunk.filter((d) => result.conflictIds.includes(copyIdOf(d.id)));
    if (held.length > 0) {
      const record = deps.records.read();
      const blockedCopies = [...new Set([...record.blockedCopies, ...held.map((d) => d.id)])];
      deps.records.write({ ...record, blockedCopies });
    }
  }

  const replacing: ResolveItem[] = ready.flatMap((d) =>
    d.staleCopyVersion === null
      ? []
      : [
          {
            id: copyIdOf(d.id),
            ifVersion: d.staleCopyVersion,
            title: d.local.title,
            content: d.local.content,
            tags: d.local.tags,
            docType: d.local.docType,
          },
        ],
  );
  for (let i = 0; i < replacing.length; i += limits.resolveChunk) {
    await deps.api.resolve(replacing.slice(i, i + limits.resolveChunk));
  }
}
