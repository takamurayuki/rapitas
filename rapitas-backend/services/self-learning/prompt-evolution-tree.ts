/**
 * PromptEvolutionTree
 *
 * Pure functions that turn a flat list of PromptEvolution rows (parentId-based
 * lineage) into a nested tree, plus the treeConfidence derivation. No I/O —
 * fixture-testable, mirroring prompt-comparison-metrics.ts's separation of
 * pure aggregation from the Prisma-backed callers (prompt-evolution-runner.ts,
 * prompt-evolution-settle.ts, the tree route).
 */
import { createLogger } from '../../config/logger';

const log = createLogger('self-learning:prompt-evolution-tree');

/** Copied verbatim from ComparisonSummary.uncertainty — see prompt-evolution-settle.ts. */
export type SignificanceLevel = 'low' | 'medium' | 'high';

/** Derived trust label for a lineage node — see plan.md "有意性・信頼度の算出方針". */
export type TreeConfidence = 'high' | 'medium' | 'low';

/** One entry of `applicableConditions.dayOfWeek`/`modelVersion`/`userSegment`. */
export interface ApplicableConditions {
  dayOfWeek: string[] | null;
  modelVersion: string[] | null;
  userSegment: string[] | null;
}

/** One recorded failure for a lineage node. */
export interface FailureCase {
  occurredAt: string;
  description: string;
  relatedExecutionId: string | null;
  failureCause: string | null;
}

/** Raw PromptEvolution row shape the tree builder needs (matches the schema columns added in task #937). */
export interface PromptEvolutionTreeRow {
  id: number;
  parentId: number | null;
  status: string;
  basePromptKey: string | null;
  taskType: string | null;
  performanceDelta: number;
  significanceLevel: SignificanceLevel | null;
  applicableConditionsJson: string | null;
  failureCasesJson: string | null;
  abTested: boolean;
  abComparisonRef: string | null;
  createdAt: Date | string;
}

/** One node of the built tree: the raw row's fields plus derived confidence, parsed attributes, and children. */
export interface PromptEvolutionTreeNode extends Omit<
  PromptEvolutionTreeRow,
  'applicableConditionsJson' | 'failureCasesJson'
> {
  treeConfidence: TreeConfidence;
  applicableConditions: ApplicableConditions;
  failureCases: FailureCase[];
  children: PromptEvolutionTreeNode[];
}

const EMPTY_CONDITIONS: ApplicableConditions = {
  dayOfWeek: null,
  modelVersion: null,
  userSegment: null,
};

/**
 * Parse `applicableConditionsJson`. Unreadable/absent input yields the
 * "no constraint recorded" shape rather than throwing — a node must always
 * expose this attribute (受入条件2), even when the value is empty.
 *
 * @param raw - Stored JSON string, or null. / 保存済みJSON文字列
 * @returns Parsed conditions, defaulting every axis to null. / 解析結果
 */
export function parseApplicableConditions(raw: string | null): ApplicableConditions {
  if (!raw) return EMPTY_CONDITIONS;
  try {
    const parsed = JSON.parse(raw) as Partial<ApplicableConditions>;
    return {
      dayOfWeek: Array.isArray(parsed.dayOfWeek) ? parsed.dayOfWeek : null,
      modelVersion: Array.isArray(parsed.modelVersion) ? parsed.modelVersion : null,
      userSegment: Array.isArray(parsed.userSegment) ? parsed.userSegment : null,
    };
  } catch {
    return EMPTY_CONDITIONS;
  }
}

/**
 * Parse `failureCasesJson`. Unreadable/absent input yields an empty array.
 *
 * @param raw - Stored JSON array string, or null. / 保存済みJSON配列文字列
 * @returns Parsed failure cases, or []. / 解析結果
 */
export function parseFailureCases(raw: string | null): FailureCase[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        occurredAt: typeof e.occurredAt === 'string' ? e.occurredAt : '',
        description: typeof e.description === 'string' ? e.description : '',
        relatedExecutionId: typeof e.relatedExecutionId === 'string' ? e.relatedExecutionId : null,
        failureCause: typeof e.failureCause === 'string' ? e.failureCause : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Derive a node's trust label from its A/B status, significance, and
 * settlement state — see plan.md's confidence table (this is the single
 * source of truth for it; the DB `treeConfidence` column is a cache).
 *
 * @param row - Fields the confidence rule reads. / 判定に使う項目
 * @returns The derived confidence level. / 信頼度
 */
export function computeTreeConfidence(
  row: Pick<PromptEvolutionTreeRow, 'abTested' | 'significanceLevel' | 'status'>,
): TreeConfidence {
  if (row.abTested && row.significanceLevel === 'low' && row.status === 'completed') return 'high';
  if (row.abTested && (row.significanceLevel === 'medium' || row.status === 'approved')) {
    return 'medium';
  }
  return 'low';
}

/**
 * Find every row id that participates in a parentId cycle (a→b→a, or a→a).
 * DB-level constraints cannot prevent this (parentId is assigned by
 * application logic, not a database CHECK), so the tree builder defends
 * against a manually-edited or otherwise corrupted lineage.
 *
 * @param rows - All rows being built into one tree. / 対象行
 * @returns Ids that must be forced to root. / 強制ルート化するID集合
 */
function detectCycleMembers(rows: PromptEvolutionTreeRow[]): Set<number> {
  const parentOf = new Map<number, number | null>();
  for (const row of rows) parentOf.set(row.id, row.parentId);

  const cyclic = new Set<number>();
  for (const row of rows) {
    const path: number[] = [];
    const visited = new Set<number>();
    let current: number | null = row.id;
    while (current !== null && parentOf.has(current)) {
      if (visited.has(current)) {
        const cycleStart = path.indexOf(current);
        for (const id of path.slice(cycleStart)) cyclic.add(id);
        break;
      }
      visited.add(current);
      path.push(current);
      current = parentOf.get(current) ?? null;
    }
  }
  return cyclic;
}

/**
 * Build the nested lineage tree from a flat row list. A row whose `parentId`
 * points outside the given rows (or participates in a cycle) becomes a root.
 *
 * @param rows - PromptEvolution rows, any order. / 対象行（順不同）
 * @returns Root nodes, newest first; each node's children are oldest first. / ルートノード配列
 */
export function buildPromptEvolutionTree(
  rows: PromptEvolutionTreeRow[],
): PromptEvolutionTreeNode[] {
  const cyclic = detectCycleMembers(rows);
  if (cyclic.size > 0) {
    log.warn(
      { ids: [...cyclic] },
      '[prompt-evolution-tree] cyclic parentId detected — forcing root',
    );
  }

  const nodesById = new Map<number, PromptEvolutionTreeNode>();
  for (const row of rows) {
    nodesById.set(row.id, {
      ...row,
      treeConfidence: computeTreeConfidence(row),
      applicableConditions: parseApplicableConditions(row.applicableConditionsJson),
      failureCases: parseFailureCases(row.failureCasesJson),
      children: [],
    });
  }

  const roots: PromptEvolutionTreeNode[] = [];
  for (const node of nodesById.values()) {
    const effectiveParentId = cyclic.has(node.id) ? null : node.parentId;
    const parent = effectiveParentId !== null ? nodesById.get(effectiveParentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const byCreatedAtAsc = (a: PromptEvolutionTreeNode, b: PromptEvolutionTreeNode) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  for (const node of nodesById.values()) node.children.sort(byCreatedAtAsc);
  roots.sort((a, b) => byCreatedAtAsc(b, a));

  return roots;
}
