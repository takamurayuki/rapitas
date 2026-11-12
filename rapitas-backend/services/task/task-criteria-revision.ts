/**
 * task-criteria-revision
 *
 * The completion-criteria revision of a task (companion design 4.5): a sha256
 * over its goals, constraints and acceptance criteria, normalised (each item
 * trimmed, empty items dropped, order kept). Computed on every read and never
 * stored — the columns are the truth, and a stored copy could drift from them.
 * Not responsible for writing criteria (task-criteria-write.ts).
 */
import { createHash } from 'node:crypto';
import { parseSpecArray } from '../../utils/common/spec-array';

/** The three criteria columns as stored (JSON-array strings, or null). */
export interface StoredCriteria {
  goals: string | null;
  constraints: string | null;
  acceptanceCriteria: string | null;
}

/** The three criteria lists, parsed and normalised. */
export interface CriteriaLists {
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

const normalise = (items: string[]): string[] =>
  items.map((s) => s.trim()).filter((s) => s.length > 0);

/**
 * Parse and normalise the stored criteria columns.
 *
 * @param row - Stored columns / 保存されている3列
 * @returns Normalised lists / 正規化した3つの一覧
 */
export function criteriaListsOf(row: StoredCriteria): CriteriaLists {
  return {
    goals: normalise(parseSpecArray(row.goals)),
    constraints: normalise(parseSpecArray(row.constraints)),
    acceptanceCriteria: normalise(parseSpecArray(row.acceptanceCriteria)),
  };
}

/**
 * The revision of a set of criteria lists.
 *
 * @param lists - Criteria lists (normalised here again) / 条件の一覧
 * @returns sha256 hex / 版（sha256）
 */
export function revisionOfLists(lists: CriteriaLists): string {
  // NOTE: Keyed JSON, not a plain join — "a" + "bc" and "ab" + "c" must differ,
  // and an item moving from goals to constraints is a different contract.
  const canonical = JSON.stringify({
    goals: normalise(lists.goals),
    constraints: normalise(lists.constraints),
    acceptanceCriteria: normalise(lists.acceptanceCriteria),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * The revision of a task row's stored criteria.
 *
 * @param row - Stored columns / 保存されている3列
 * @returns sha256 hex / 版（sha256）
 */
export function computeCriteriaRevision(row: StoredCriteria): string {
  return revisionOfLists(criteriaListsOf(row));
}

/** The slice of Prisma readCriteriaRevision needs. */
export interface CriteriaRevisionDb {
  task: {
    findUnique(args: {
      where: { id: number };
      select: { goals: true; constraints: true; acceptanceCriteria: true };
    }): Promise<StoredCriteria | null>;
  };
}

/**
 * The task's current criteria revision. Never throws.
 *
 * @param db - Prisma client / Prismaクライアント
 * @param taskId - Task id / タスクID
 * @returns The revision, or null when the task cannot be read / 版（読めなければ null）
 */
export async function readCriteriaRevision(
  db: CriteriaRevisionDb,
  taskId: number,
): Promise<string | null> {
  try {
    const row = await db.task.findUnique({
      where: { id: taskId },
      select: { goals: true, constraints: true, acceptanceCriteria: true },
    });
    return row ? computeCriteriaRevision(row) : null;
  } catch {
    return null;
  }
}
