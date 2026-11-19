/**
 * PlacedRecord
 *
 * A note record as stage-1 reads return it: the stage-0 record plus where it
 * sits (`placement`, from describePlacement) and where it came from
 * (`source`, `sourceTaskId`, `followsTask`). The list and the detail both go
 * through here, so they cannot disagree about a note's placement.
 *
 * Not responsible for choosing which notes to read — see note-query.
 */
import { toRecord, type NoteRecord, type NoteRow, type PrismaInstance } from '../note-record';
import { describePlacement, lookupForNotes, type PlacementLookup } from './describe-placement';
import type { NotePlacement } from './placement-types';

/** A note with its placement and provenance. */
export interface PlacedNoteRecord extends NoteRecord {
  placement: NotePlacement;
  source: string;
  sourceTaskId: number | null;
  followsTask: boolean;
}

/**
 * Turn rows into placed records with a lookup already loaded.
 *
 * @param row - A note row / ノート行
 * @param lookup - The workspace's placement rows / 置き場所の参照表
 * @returns The placed record / 置き場所付きのノート
 */
export function toPlacedRecord(row: NoteRow, lookup: PlacementLookup): PlacedNoteRecord {
  return {
    ...toRecord(row),
    placement: describePlacement(row, lookup),
    source: row.source ?? 'manual',
    sourceTaskId: row.sourceTaskId ?? null,
    followsTask: row.followsTask ?? false,
  };
}

/**
 * Rows → placed records, loading only the themes / categories / folders the
 * rows point at.
 *
 * @param db - Client / クライアント
 * @param rows - Note rows / ノート行
 * @returns Placed records, in the same order / 同じ順の置き場所付きノート
 */
export async function attachPlacement(
  db: PrismaInstance,
  rows: NoteRow[],
): Promise<PlacedNoteRecord[]> {
  const lookup = await lookupForNotes(db, rows);
  return rows.map((row) => toPlacedRecord(row, lookup));
}
