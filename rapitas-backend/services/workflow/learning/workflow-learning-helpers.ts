/**
 * Workflow Learning Helpers
 *
 * Pure utility functions used by the learning optimizer: phase timing
 * calculation, keyword extraction, phase-skip detection, condition matching,
 * rule upsert, and stale-rule deactivation. No external side effects except
 * the database writes inside `upsertRule` and `deactivateStaleRules`.
 */
import { prisma } from '../../../config';

// ───────────────────────────────────────────────
// Types (shared across learning sub-modules)
// ───────────────────────────────────────────────

export interface PhaseTimings {
  research?: number;
  plan?: number;
  implement?: number;
  verify?: number;
}

export interface RuleGenerationResult {
  rulesCreated: number;
  rulesUpdated: number;
  rulesDeactivated: number;
  details: string[];
}

// ───────────────────────────────────────────────
// Phase Timing Helpers
// ───────────────────────────────────────────────

/**
 * Derive per-phase durations (in minutes) from a task's activity log.
 *
 * @param activityLogs - Ordered activity log entries for the task. / タスクのアクティビティログ
 * @param taskCreatedAt - Task creation timestamp used as the baseline. / ベースラインとなるタスク作成日時
 * @returns Map of phase name to duration in minutes. / フェーズ名→分数のマップ
 */
export function calculatePhaseTimings(
  activityLogs: Array<{ action: string; createdAt: Date; metadata: string | null }>,
  taskCreatedAt: Date,
): PhaseTimings {
  const timings: PhaseTimings = {};
  const statusChanges = activityLogs
    .filter(
      (l) =>
        l.action === 'workflow_status_updated' ||
        l.action === 'plan_approved' ||
        l.action === 'plan_auto_approved',
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let lastTimestamp = taskCreatedAt;

  for (const change of statusChanges) {
    const metadata = change.metadata ? JSON.parse(change.metadata) : {};
    const newStatus = metadata.newStatus || change.action;
    const durationMin = Math.round((change.createdAt.getTime() - lastTimestamp.getTime()) / 60000);

    if (newStatus === 'research_done' || newStatus === 'research') {
      timings.research = durationMin;
    } else if (newStatus === 'plan_created' || newStatus === 'plan_approved') {
      timings.plan = durationMin;
    } else if (newStatus === 'in_progress') {
      timings.implement = durationMin;
    } else if (newStatus === 'completed' || newStatus === 'verify_done') {
      timings.verify = durationMin;
    }

    lastTimestamp = change.createdAt;
  }

  return timings;
}

// ───────────────────────────────────────────────
// Keyword Extraction
// ───────────────────────────────────────────────

/**
 * Extract significant keywords from a task title.
 *
 * Strips Japanese particles, English stop-words, and short tokens.
 *
 * @param title - Task title string. / タスクタイトル文字列
 * @returns Array of up to 10 lowercase keywords. / 最大10件の小文字キーワード配列
 */
export function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'の', 'を', 'に', 'は', 'が', 'で', 'と', 'する', 'した', 'です', 'ます',
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'for', 'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'from', 'by', 'with', 'as', 'of',
  ]);

  return title
    .toLowerCase()
    .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
    .slice(0, 10);
}

// ───────────────────────────────────────────────
// Phase Skip Detection
// ───────────────────────────────────────────────

/**
 * Determine which workflow phases were never entered during task execution.
 *
 * @param workflowMode - The mode used for this task execution. / タスク実行に使用されたモード
 * @param activityLogs - Activity log entries to scan for status transitions. / ステータス遷移をスキャンするアクティビティログ
 * @returns Array of phase names that were skipped. / スキップされたフェーズ名の配列
 */
export function detectSkippedPhases(
  workflowMode: string,
  activityLogs: Array<{ action: string; metadata: string | null }>,
): string[] {
  const skipped: string[] = [];

  const statusSet = new Set<string>();
  for (const logEntry of activityLogs) {
    if (logEntry.metadata) {
      try {
        const meta = JSON.parse(logEntry.metadata);
        if (meta.newStatus) statusSet.add(meta.newStatus);
        if (meta.previousStatus) statusSet.add(meta.previousStatus);
      } catch {
        // ignore
      }
    }
  }

  // Was research skipped in comprehensive/standard mode?
  if (
    (workflowMode === 'comprehensive' || workflowMode === 'standard') &&
    !statusSet.has('research_done')
  ) {
    skipped.push('research');
  }

  // Was plan skipped in comprehensive/standard mode?
  if (
    (workflowMode === 'comprehensive' || workflowMode === 'standard') &&
    !statusSet.has('plan_created') &&
    !statusSet.has('plan_approved')
  ) {
    skipped.push('plan');
  }

  return skipped;
}

// ───────────────────────────────────────────────
// Rule Condition Matching
// ───────────────────────────────────────────────

/**
 * Test whether a rule condition matches the given task and complexity score.
 *
 * @param condition - Parsed condition object from the rule record. / ルールレコードから解析された条件オブジェクト
 * @param task - Task fields relevant to matching. / マッチングに使用するタスクフィールド
 * @param complexityScore - The task's computed complexity score. / タスクの計算済み複雑度スコア
 * @returns True when all condition clauses match. / すべての条件が一致する場合true
 */
export function matchesCondition(
  condition: Record<string, unknown>,
  task: { themeId: number | null; workflowMode: string | null },
  complexityScore: number,
): boolean {
  if (condition.themeId !== undefined && condition.themeId !== task.themeId) {
    return false;
  }

  if (
    condition.predictedComplexityBelow !== undefined &&
    complexityScore > (condition.predictedComplexityBelow as number)
  ) {
    return false;
  }

  if (condition.originalMode !== undefined && condition.originalMode !== task.workflowMode) {
    return false;
  }

  return true;
}

// ───────────────────────────────────────────────
// Rule Persistence
// ───────────────────────────────────────────────

/**
 * Insert or update a WorkflowOptimizationRule.
 *
 * @param ruleType - Rule category identifier. / ルールカテゴリ識別子
 * @param condition - Serialised JSON condition string. / シリアライズされたJSON条件文字列
 * @param recommendation - Serialised JSON recommendation string. / シリアライズされたJSONレコメンデーション文字列
 * @param confidence - Confidence score between 0 and 1. / 0〜1の信頼度スコア
 * @param sampleSize - Number of learning records that produced this rule. / このルールを生成した学習レコード数
 * @param description - Human-readable description for display. / 表示用の人間が読める説明
 * @param result - Mutable result object to increment counters and append details. / カウンターをインクリメントして詳細を追加する可変結果オブジェクト
 */
export async function upsertRule(
  ruleType: string,
  condition: string,
  recommendation: string,
  confidence: number,
  sampleSize: number,
  description: string,
  result: RuleGenerationResult,
): Promise<void> {
  const existing = await prisma.workflowOptimizationRule.findFirst({
    where: { ruleType, condition, isActive: true },
  });

  if (existing) {
    await prisma.workflowOptimizationRule.update({
      where: { id: existing.id },
      data: {
        recommendation,
        confidence,
        sampleSize,
        successRate: confidence,
        description,
        lastEvaluated: new Date(),
      },
    });
    result.rulesUpdated++;
    result.details.push(`ルール更新: ${description}`);
  } else {
    await prisma.workflowOptimizationRule.create({
      data: {
        ruleType,
        condition,
        recommendation,
        confidence,
        sampleSize,
        successRate: confidence,
        description,
        isActive: true,
      },
    });
    result.rulesCreated++;
    result.details.push(`ルール作成: ${description}`);
  }
}

/**
 * Deactivate optimization rules that have not been evaluated in 30+ days.
 *
 * @param result - Mutable result object to update deactivation count and details. / 非活性化カウントと詳細を更新する可変結果オブジェクト
 */
export async function deactivateStaleRules(result: RuleGenerationResult): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const staleRules = await prisma.workflowOptimizationRule.updateMany({
    where: {
      isActive: true,
      lastEvaluated: { lt: thirtyDaysAgo },
    },
    data: { isActive: false },
  });

  if (staleRules.count > 0) {
    result.rulesDeactivated += staleRules.count;
    result.details.push(`${staleRules.count}件の古いルールを非活性化`);
  }
}
