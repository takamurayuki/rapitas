/**
 * PromptComparisonRunner
 *
 * Orchestrates a full current-vs-candidate shadow comparison for one
 * PromptEvolution candidate: resolves sample tasks, runs all four
 * (arm × knowledge) cells sequentially (per-cell isolation via
 * prompt-comparison-cell-executor.ts), enforces a cost budget, and persists
 * the finished `ComparisonRecord` via the existing store. Cells run in strict
 * series — never in parallel — so shadow worktrees never contend with a real
 * task's worktree under the per-task mutex assumption (plan.md 設計判断の根拠
 * — 実行方式).
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { resolveGitRoot } from '../../workflow/workflow-cli-executor-helpers';
import { runComparisonCell } from './prompt-comparison-cell-executor';
import {
  acquireComparisonLock,
  releaseComparisonLock,
  readComparisonRecord,
  writeComparisonRecord,
} from './prompt-comparison-store';
import { buildComparisonSummary } from './prompt-comparison-metrics';
import type {
  ComparisonArm,
  ComparisonCell,
  ComparisonRecord,
  ComparisonRun,
  KnowledgeCondition,
} from './prompt-comparison-types';

const log = createLogger('self-learning:comparison-runner');

/** Default cost ceiling for one comparison run when the caller does not specify one. */
export const DEFAULT_COMPARISON_BUDGET_USD = 3;

/** Default model used for shadow executions (matches the fixture modelName in prompt-comparison-store.test.ts). */
export const DEFAULT_COMPARISON_MODEL = 'claude-sonnet-5';

const ARMS: readonly ComparisonArm[] = ['current', 'candidate'];
const KNOWLEDGE_CONDITIONS: readonly KnowledgeCondition[] = ['with', 'without'];

export class ComparisonLockedError extends Error {
  constructor(evolutionId: number) {
    super(`comparison_locked:${evolutionId}`);
    this.name = 'ComparisonLockedError';
  }
}

interface SampleTaskInfo {
  id: number;
  title: string;
  description: string | null;
  worktreeBaseDir: string | null;
  repositoryUrl: string | null;
}

/**
 * Acquire the per-candidate comparison lock and seed an `in_progress` record.
 * Purely synchronous side effects, so a caller (the `/compare` route) can
 * return an immediate 409 without waiting for the shadow runs themselves.
 *
 * @param params - Identity/budget for the run being started. / 開始する実行の識別情報・予算
 * @returns The seeded (in_progress) record. / 起動直後のレコード
 * @throws {ComparisonLockedError} When a run for this candidate is already in progress. / 既に実行中の場合
 */
export function beginComparisonRun(params: {
  evolutionId: number;
  role: string;
  modelName: string;
  sampleTaskIds: number[];
  budgetUsd: number;
}): ComparisonRecord {
  if (!acquireComparisonLock(params.evolutionId)) {
    throw new ComparisonLockedError(params.evolutionId);
  }
  const record: ComparisonRecord = {
    promptEvolutionId: params.evolutionId,
    role: params.role,
    modelName: params.modelName,
    budgetUsd: params.budgetUsd,
    createdAt: new Date().toISOString(),
    // NOTE: ComparisonRecord.status is 'in_progress' | 'done' only
    // (prompt-comparison-types.ts — must not be changed, see plan.md 既存機能
    // チェック). 'in_progress' already carries the "shadow runs still
    // executing, discard on restart" meaning the design needed for "running".
    status: 'in_progress',
    sampleTaskIds: params.sampleTaskIds,
    arms: [],
    summary: null,
    knowledgeSnapshotHash: null,
    stagedTaskIds: null,
    stagedComplexityBands: null,
  };
  writeComparisonRecord(record);
  return record;
}

/**
 * Resolve sample tasks (title/description/worktree base dir/repository url).
 * A task id that no longer exists is silently omitted — the comparison
 * proceeds with the remaining samples rather than failing outright (plan.md
 * エッジケースの方針 — サンプルタスクが見つからない).
 *
 * @param sampleTaskIds - Candidate sample task ids. / サンプルタスクID候補
 * @returns Resolved sample tasks, missing ids omitted. / 解決済みサンプル（欠損は除外）
 */
async function resolveSampleTasks(sampleTaskIds: number[]): Promise<SampleTaskInfo[]> {
  const cwdGitRoot = await resolveGitRoot(process.cwd());
  const resolved: SampleTaskInfo[] = [];
  for (const id of sampleTaskIds) {
    const row = await prisma.task
      .findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          workingDirectory: true,
          theme: { select: { workingDirectory: true, repositoryUrl: true } },
        },
      })
      .catch(() => null);
    if (!row) {
      log.warn({ sampleTaskId: id }, '[comparison-runner] sample_task_not_found — skipping');
      continue;
    }
    resolved.push({
      id: row.id,
      title: row.title,
      description: row.description,
      worktreeBaseDir: row.theme?.workingDirectory ?? row.workingDirectory ?? cwdGitRoot,
      repositoryUrl: row.theme?.repositoryUrl ?? null,
    });
  }
  return resolved;
}

/**
 * Run every (arm × knowledge) cell for every resolved sample task, in strict
 * series, stopping new cell executions once the cumulative cost reaches
 * `budgetUsd`. Already-completed cell results are always kept — a
 * budget-truncated run still produces a partial, usable `ComparisonRecord`
 * (plan.md エッジケースの方針 — budgetUsd超過).
 *
 * ASSUMES the caller already holds the comparison lock (via
 * `beginComparisonRun`) — always releases it in `finally`.
 *
 * @param params - Full identity/content needed to execute every cell. / セル実行に必要な全情報
 * @returns The finished (or budget-truncated) `ComparisonRecord`. / 完成した比較レコード
 */
export async function finishComparisonRun(params: {
  evolutionId: number;
  role: string;
  modelName: string;
  afterPrompt: string;
  sampleTaskIds: number[];
  budgetUsd: number;
}): Promise<ComparisonRecord> {
  try {
    const sampleTasks = await resolveSampleTasks(params.sampleTaskIds);
    const runsByCell = new Map<string, ComparisonRun[]>();
    for (const arm of ARMS) {
      for (const knowledge of KNOWLEDGE_CONDITIONS) {
        runsByCell.set(`${arm}:${knowledge}`, []);
      }
    }

    let costAccumUsd = 0;
    let executionSeq = 0;
    let budgetExhausted = false;

    outer: for (const arm of ARMS) {
      for (const knowledge of KNOWLEDGE_CONDITIONS) {
        for (const task of sampleTasks) {
          if (costAccumUsd >= params.budgetUsd) {
            budgetExhausted = true;
            break outer;
          }
          if (!task.worktreeBaseDir) continue;
          const run = await runComparisonCell({
            evolutionId: params.evolutionId,
            sampleTaskId: task.id,
            arm,
            knowledge,
            modelName: params.modelName,
            task: { title: task.title, description: task.description },
            candidateAddendum: params.afterPrompt,
            worktreeBaseDir: task.worktreeBaseDir,
            repositoryUrl: task.repositoryUrl,
            executionSeq: executionSeq++,
          });
          runsByCell.get(`${arm}:${knowledge}`)?.push(run);
          costAccumUsd += run.costUsd;
        }
      }
    }
    if (budgetExhausted) {
      log.warn(
        { evolutionId: params.evolutionId, costAccumUsd, budgetUsd: params.budgetUsd },
        '[comparison-runner] budget exhausted — remaining cells skipped, keeping completed results',
      );
    }

    const cells: ComparisonCell[] = ARMS.flatMap((arm) =>
      KNOWLEDGE_CONDITIONS.map((knowledge) => ({
        arm,
        knowledge,
        runs: runsByCell.get(`${arm}:${knowledge}`) ?? [],
      })),
    );

    const record: ComparisonRecord = {
      promptEvolutionId: params.evolutionId,
      role: params.role,
      modelName: params.modelName,
      budgetUsd: params.budgetUsd,
      createdAt: new Date().toISOString(),
      status: 'done',
      sampleTaskIds: params.sampleTaskIds,
      arms: cells,
      summary: buildComparisonSummary(cells),
      knowledgeSnapshotHash: null,
      stagedTaskIds: null,
      stagedComplexityBands: null,
    };
    writeComparisonRecord(record);
    return record;
  } finally {
    releaseComparisonLock(params.evolutionId);
  }
}

export interface RunPromptComparisonOptions {
  evolutionId: number;
  sampleTaskIds: number[];
  budgetUsd?: number;
}

/**
 * Single-call entry point: acquires the comparison lock, runs every cell, and
 * releases the lock — the standalone API used by tests and the scheduler hook
 * (the `/compare` route instead calls `beginComparisonRun`+`finishComparisonRun`
 * separately so it can respond before the run completes).
 *
 * @param options - Candidate id, sample task ids, and an optional budget override. / 候補ID・サンプル・予算上限
 * @returns The finished `ComparisonRecord`. / 完成した比較レコード
 * @throws {ComparisonLockedError} When a run for this candidate is already in progress. / 既に実行中の場合
 */
export async function runPromptComparison(
  options: RunPromptComparisonOptions,
): Promise<ComparisonRecord> {
  const evolution = await prisma.promptEvolution.findUnique({
    where: { id: options.evolutionId },
    select: { basePromptKey: true, afterPrompt: true },
  });
  const role = evolution?.basePromptKey?.replace(/^workflow_role_/, '') ?? 'unknown';
  const afterPrompt = evolution?.afterPrompt ?? '';
  const modelName = DEFAULT_COMPARISON_MODEL;
  const budgetUsd = options.budgetUsd ?? DEFAULT_COMPARISON_BUDGET_USD;

  beginComparisonRun({
    evolutionId: options.evolutionId,
    role,
    modelName,
    sampleTaskIds: options.sampleTaskIds,
    budgetUsd,
  });
  return finishComparisonRun({
    evolutionId: options.evolutionId,
    role,
    modelName,
    afterPrompt,
    sampleTaskIds: options.sampleTaskIds,
    budgetUsd,
  });
}

/**
 * Select the most recently completed tasks as shadow-comparison samples. A
 * deliberately simple "latest N done tasks" extraction — `Task` carries no
 * per-role dimension, so `role` is accepted for signature/API symmetry with
 * the manual `/compare` trigger but does not additionally filter (plan.md
 * 実装チェックリスト — 既存の複雑なサンプリングロジックの流用はしない).
 *
 * @param role - Workflow role the candidate addendum targets (not used to filter). / 対象ロール（絞り込みには未使用）
 * @param limit - Max sample tasks to return. / 取得件数上限
 * @returns Sample task ids, most recently completed first. / サンプルタスクID（完了日時降順）
 */
export async function selectComparisonSampleTasks(role: string, limit: number): Promise<number[]> {
  void role;
  const rows = await prisma.task.findMany({
    where: { status: 'done' },
    orderBy: { completedAt: 'desc' },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Kick off shadow comparisons for every `proposed` candidate that does not
 * already have a completed comparison record. Called from the Monday-7:02
 * scheduler hook. Each candidate is isolated in its own try/catch so one
 * failure never blocks the rest (plan.md 実装チェックリスト — スケジューラフック).
 *
 * @param sampleLimit - Sample tasks per candidate. / 候補あたりのサンプル件数
 */
export async function triggerComparisonsForPendingProposals(sampleLimit = 5): Promise<void> {
  const proposed = await prisma.promptEvolution.findMany({
    where: { status: 'proposed' },
    select: { id: true, basePromptKey: true },
  });
  for (const row of proposed) {
    if (readComparisonRecord(row.id)) continue;
    const role = row.basePromptKey?.replace(/^workflow_role_/, '') ?? '';
    if (!role) continue;
    try {
      const sampleTaskIds = await selectComparisonSampleTasks(role, sampleLimit);
      if (sampleTaskIds.length === 0) continue;
      await runPromptComparison({ evolutionId: row.id, sampleTaskIds });
    } catch (err) {
      if (err instanceof ComparisonLockedError) continue;
      log.warn({ err, evolutionId: row.id }, '[comparison-runner] scheduled comparison failed');
    }
  }
}
