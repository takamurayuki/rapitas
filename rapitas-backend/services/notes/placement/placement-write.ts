/**
 * PlacementWrite
 *
 * The client-facing half of the placement contract on PUT / PATCH (design
 * §2.2 contracts 7 and 8, API table): validating a requested placement inside
 * the request's workspace, refusing what a client may not do, and the column
 * values a person's move writes.
 *
 * What a client may never do here: write `source` other than manual / chat,
 * `sourceTaskId`, `followsTask` or `sourceRef` (they are not even accepted as
 * input), create a note under a reserved fixed-id prefix, move a deliverable
 * outside the Q7 range (theme / category only), or turn a deliverable back
 * into a manual note through `source`.
 *
 * Not responsible for the conditional write itself — note-write calls these.
 */
import type { PrismaInstance } from '../note-record';
import { isTargetInScope, type PlacementTargetModel } from './placement-scope';
import {
  columnsFor,
  isDeliverableSource,
  isReservedNoteId,
  type ClientWritableSource,
  type PlacementColumns,
  type PlacementRequest,
} from './placement-types';

/** Why a placement-related write was refused, with the status to answer. */
export class NotePlacementError extends Error {
  constructor(
    readonly code:
      | 'placement_target_not_found'
      | 'invalid_placement'
      | 'placement_out_of_range'
      | 'reserved_note_id'
      | 'source_not_writable',
    readonly status: 400 | 404,
  ) {
    super(code);
    this.name = 'NotePlacementError';
  }
}

/** The placement-related part of a client write. */
export interface PlacementInput {
  placement?: PlacementRequest;
  source?: ClientWritableSource;
}

const TARGET_MODEL: Record<'theme' | 'category' | 'folder', PlacementTargetModel> = {
  theme: 'theme',
  category: 'category',
  folder: 'noteFolder',
};

/**
 * Validate a requested placement and turn it into columns. The target is
 * looked up in the request's workspace; another workspace's target is the
 * same 404 as a missing one.
 *
 * @param db - The client / クライアント
 * @param placement - What the client asked for / 要求された置き場所
 * @returns The columns to write / 書き込む列
 * @throws {NotePlacementError} invalid_placement (400) or placement_target_not_found (404)
 */
export async function resolvePlacementTarget(
  db: PrismaInstance,
  placement: PlacementRequest,
): Promise<PlacementColumns> {
  if (placement.kind === 'none') return columnsFor('none');
  if (typeof placement.id !== 'number' || !Number.isInteger(placement.id) || placement.id <= 0) {
    throw new NotePlacementError('invalid_placement', 400);
  }
  if (!(await isTargetInScope(db, TARGET_MODEL[placement.kind], placement.id))) {
    throw new NotePlacementError('placement_target_not_found', 404);
  }
  return columnsFor(placement.kind, placement.id);
}

/** The current row as the guard needs it. */
export interface GuardedRow {
  source?: string | null;
}

/**
 * Refuse what a client write may not do to this row (or to this id, when
 * there is no row yet).
 *
 * @param id - The note id / ノートID
 * @param current - The row as read, or null when creating / 読んだ行（作成時は null）
 * @param input - The placement-related input / 置き場所関連の入力
 * @throws {NotePlacementError} reserved_note_id, placement_out_of_range or source_not_writable (400)
 */
export function guardPlacementWrite(
  id: string,
  current: GuardedRow | null,
  input: PlacementInput,
): void {
  if (!current) {
    // Contract 8: the deliverable path must be the first to create these ids.
    if (isReservedNoteId(id)) throw new NotePlacementError('reserved_note_id', 400);
    return;
  }
  if (!isDeliverableSource(current.source)) return;
  // Q7: a deliverable moves only between themes and directly under a
  // category; never into a memo folder or 未分類 by hand.
  const kind = input.placement?.kind;
  if (kind && kind !== 'theme' && kind !== 'category') {
    throw new NotePlacementError('placement_out_of_range', 400);
  }
  if (input.source !== undefined && input.source !== current.source) {
    throw new NotePlacementError('source_not_writable', 400);
  }
}

/**
 * The extra columns a client write sets, beyond the four versioned fields.
 *
 * @param current - The row as read, or null when creating / 読んだ行（作成時は null）
 * @param input - The placement-related input / 置き場所関連の入力
 * @param columns - The resolved placement, when one was sent / 解決済みの置き場所
 * @returns Data to merge into the create / update / 作成・更新に足すデータ
 */
export function placementWriteData(
  current: GuardedRow | null,
  input: PlacementInput,
  columns: PlacementColumns | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (columns) {
    Object.assign(data, columns);
    // Contract 7: a person's move stops following for good (until the
    // explicit "タスクの分類に戻す").
    data.followsTask = false;
  }
  if (input.source !== undefined && !isDeliverableSource(current?.source)) {
    data.source = input.source;
  }
  return data;
}
