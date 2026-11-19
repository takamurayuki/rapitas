/**
 * MigrationMarker
 *
 * "Has this one-time notes migration already run?" — a row per migration key
 * in NoteMigrationMarker. Written only after a run finished, so a crash in
 * the middle is resumed (each run is itself conditional and safe to repeat).
 * These migrations cover every workspace, so the marker's workspaceId is
 * always NULL and it is read by the jobs outside any workspace scope.
 */
import type { PrismaInstance } from '../note-record';
import { isUniqueViolation } from '../note-write';

/** Placement initial values (design §2.2「既存ノートの初期値」). */
export const PLACEMENT_INITIAL_KEY = 'note-placement-initial-v1';
/** Deliverable baseline (design §3.3「機能を有効にした時点」). */
export const DELIVERABLE_BASELINE_KEY = 'deliverable-baseline-v1';

/**
 * Whether a migration has been recorded as done.
 *
 * @param db - Client / クライアント
 * @param key - Migration key / 移行キー
 * @returns true when it already ran / 実行済みなら true
 */
export async function hasMarker(db: PrismaInstance, key: string): Promise<boolean> {
  const row = await db.noteMigrationMarker.findFirst({ where: { key }, select: { key: true } });
  return !!row;
}

/**
 * Record a migration as done. A second writer (another process finishing the
 * same run) is not an error.
 *
 * @param db - Client / クライアント
 * @param key - Migration key / 移行キー
 * @param detail - What it did, for the operator / 実行内容の要約
 */
export async function writeMarker(
  db: PrismaInstance,
  key: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await db.noteMigrationMarker.create({
      data: { key, workspaceId: null, detail: JSON.stringify(detail) },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
