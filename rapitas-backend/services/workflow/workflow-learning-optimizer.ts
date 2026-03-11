/**
 * ワークフロー学習最適化サービス
 *
 * 完了タスクのワークフロー実行データを蓄積・分析し、
 * 類似タスクのワークフローモードを自動最適化するシステム
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { analyzeTaskComplexity, type TaskComplexityInput } from './complexity-analyzer';

const log = createLogger('workflow-learning');

// ───────────────────────────────────────────────
// 型定義
// ───────────────────────────────────────────────

interface PhaseTimings {
  research?: number;
  plan?: number;
  implement?: number;
  verify?: number;
}

interface WorkflowRecommendation {
  taskId: number;
  currentMode: string;
  recommendedMode: string;
  skipPhases: string[];
  estimatedDuration: number;
  confidence: number;
  reasons: string[];
  matchedRules: Array<{
    ruleId: number;
    description: string;
    confidence: number;
  }>;
}

interface LearningStats {
  totalRecords: number;
  byMode: Record<string, { count: number; avgDuration: number; successRate: number }>;
  byOutcome: Record<string, number>;
  overrideRate: number;
  avgAccuracy: number;
  recentTrend: {
    period: string;
    modeDistribution: Record<string, number>;
  };
}

interface RuleGenerationResult {
  rulesCreated: number;
  rulesUpdated: number;
  rulesDeactivated: number;
  details: string[];
}

// ───────────────────────────────────────────────
// 学習記録の収集
// ───────────────────────────────────────────────

/**
 * タスク完了時にワークフロー実行データを記録する
 */
export async function recordWorkflowCompletion(taskId: number): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        taskLabels: { include: { label: true } },
        activityLogs: {
          where: {
            action: {
              in: [
                'workflow_status_updated',
                'plan_approved',
                'plan_auto_approved',
                'plan_rejected',
                'workflow_mode_changed',
              ],
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!task) {
      log.warn({ taskId }, 'Task not found for workflow learning record');
      return;
    }

    // フェーズタイミングをActivityLogから算出
    const phaseTimings = calculatePhaseTimings(task.activityLogs, task.createdAt);

    // 実際の所要時間（タスク作成～完了）
    const actualDuration = task.completedAt
      ? Math.round((task.completedAt.getTime() - task.createdAt.getTime()) / 60000)
      : null;

    // タイトルからキーワード抽出
    const titleKeywords = extractKeywords(task.title);

    // 複雑度分析を再実行して予測値を取得
    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
    };
    const analysis = analyzeTaskComplexity(complexityInput);

    // モード変更履歴からオーバーライド情報を取得
    const modeChangeLog = task.activityLogs.find((l) => l.action === 'workflow_mode_changed');
    let overriddenFrom: string | null = null;
    if (modeChangeLog && modeChangeLog.metadata) {
      try {
        const meta = JSON.parse(modeChangeLog.metadata);
        overriddenFrom = meta.previousMode || null;
      } catch {
        // ignore
      }
    }

    // スキップされたフェーズを判定
    const skippedPhases = detectSkippedPhases(
      task.workflowMode || 'comprehensive',
      task.activityLogs,
    );

    await prisma.workflowLearningRecord.create({
      data: {
        taskId,
        workflowMode: task.workflowMode || 'comprehensive',
        predictedComplexity: task.complexityScore ?? analysis.complexityScore,
        actualDurationMinutes: actualDuration,
        estimatedDuration: analysis.estimatedExecutionTime,
        skippedPhases: JSON.stringify(skippedPhases),
        phaseTimings: JSON.stringify(phaseTimings),
        outcome: task.status === 'done' ? 'completed' : 'cancelled',
        wasOverridden: task.workflowModeOverride,
        overriddenFrom,
        categoryId: task.theme?.categoryId ?? null,
        themeId: task.themeId,
        labels: JSON.stringify(task.taskLabels.map((tl) => tl.label.name)),
        titleKeywords: JSON.stringify(titleKeywords),
        complexityFactors: JSON.stringify(analysis.analysisBreakdown),
        success: task.status === 'done',
      },
    });

    log.info(
      { taskId, mode: task.workflowMode, duration: actualDuration },
      'Workflow learning record created',
    );
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to record workflow completion');
  }
}

// ───────────────────────────────────────────────
// 最適化ルールの自動生成
// ───────────────────────────────────────────────

const MIN_SAMPLES_FOR_RULE = 5;
const HIGH_SUCCESS_THRESHOLD = 0.85;
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * 蓄積された学習データからルールを自動生成・更新する
 */
export async function generateOptimizationRules(): Promise<RuleGenerationResult> {
  const result: RuleGenerationResult = {
    rulesCreated: 0,
    rulesUpdated: 0,
    rulesDeactivated: 0,
    details: [],
  };

  try {
    const records = await prisma.workflowLearningRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    if (records.length < MIN_SAMPLES_FOR_RULE) {
      result.details.push(`サンプル不足: ${records.length}/${MIN_SAMPLES_FOR_RULE}件`);
      return result;
    }

    // ルール1: モードダウングレード検出
    await detectModeDowngradePatterns(records, result);

    // ルール2: フェーズスキップ検出
    await detectPhaseSkipPatterns(records, result);

    // ルール3: テーマ別の最適モード検出
    await detectThemeOptimalMode(records, result);

    // ルール4: 複雑度スコアの閾値調整
    await detectComplexityThresholdAdjustment(records, result);

    // 古いルールの非活性化
    await deactivateStaleRules(result);

    log.info(result, 'Optimization rules generation completed');
  } catch (error) {
    log.error({ err: error }, 'Failed to generate optimization rules');
  }

  return result;
}

/**
 * comprehensiveモードで実行されたが、実際にはlightweight/standardで十分だったケースを検出
 */
async function detectModeDowngradePatterns(
  records: Array<{
    workflowMode: string;
    actualDurationMinutes: number | null;
    estimatedDuration: number | null;
    outcome: string;
    success: boolean;
    predictedComplexity: number | null;
    themeId: number | null;
    categoryId: number | null;
    titleKeywords: string;
    wasOverridden: boolean;
    overriddenFrom: string | null;
  }>,
  result: RuleGenerationResult,
): Promise<void> {
  // オーバーライドでダウングレードされて成功したケースを分析
  const downgraded = records.filter((r) => r.wasOverridden && r.overriddenFrom && r.success);

  if (downgraded.length < MIN_SAMPLES_FOR_RULE) return;

  // ダウングレードの成功率を算出
  const allOverridden = records.filter((r) => r.wasOverridden && r.overriddenFrom);
  const successRate = downgraded.length / Math.max(1, allOverridden.length);

  if (successRate >= HIGH_SUCCESS_THRESHOLD) {
    // 複雑度スコアの分布を確認
    const complexities = downgraded
      .map((r) => r.predictedComplexity)
      .filter((c): c is number => c !== null);

    if (complexities.length === 0) return;

    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    const maxComplexity = Math.max(...complexities);

    const condition = JSON.stringify({
      predictedComplexityBelow: Math.round(maxComplexity + 5),
      originalMode: 'comprehensive',
    });

    const recommendation = JSON.stringify({
      action: 'downgrade_mode',
      targetMode: 'standard',
      reason: `複雑度${Math.round(avgComplexity)}以下のタスクでcomprehensiveモード不要（成功率${Math.round(successRate * 100)}%）`,
    });

    await upsertRule(
      'downgrade_mode',
      condition,
      recommendation,
      successRate,
      allOverridden.length,
      `複雑度${Math.round(maxComplexity)}以下ではstandardモードで十分（${downgraded.length}件の実績）`,
      result,
    );
  }
}

/**
 * 特定フェーズが実質スキップ（極短時間で完了）されているパターンを検出
 */
async function detectPhaseSkipPatterns(
  records: Array<{
    workflowMode: string;
    phaseTimings: string;
    skippedPhases: string;
    outcome: string;
    success: boolean;
    predictedComplexity: number | null;
    titleKeywords: string;
  }>,
  result: RuleGenerationResult,
): Promise<void> {
  const phases = ['research', 'plan'] as const;

  for (const phase of phases) {
    // このフェーズをスキップして成功したタスク
    const skipped = records.filter((r) => {
      try {
        const sp: string[] = JSON.parse(r.skippedPhases);
        return sp.includes(phase) && r.success;
      } catch {
        return false;
      }
    });

    if (skipped.length < MIN_SAMPLES_FOR_RULE) continue;

    // スキップありの成功率
    const allWithPhaseSkip = records.filter((r) => {
      try {
        const sp: string[] = JSON.parse(r.skippedPhases);
        return sp.includes(phase);
      } catch {
        return false;
      }
    });

    const successRate = skipped.length / Math.max(1, allWithPhaseSkip.length);

    if (successRate >= HIGH_SUCCESS_THRESHOLD) {
      // 共通する複雑度帯を特定
      const complexities = skipped
        .map((r) => r.predictedComplexity)
        .filter((c): c is number => c !== null);

      const maxComplexity = complexities.length > 0 ? Math.max(...complexities) : 35;

      const condition = JSON.stringify({
        predictedComplexityBelow: Math.round(maxComplexity),
        phase,
      });

      const recommendation = JSON.stringify({
        action: 'skip_phase',
        phase,
        reason: `複雑度${Math.round(maxComplexity)}以下では${phase}フェーズ不要（成功率${Math.round(successRate * 100)}%）`,
      });

      await upsertRule(
        'skip_phase',
        condition,
        recommendation,
        successRate,
        allWithPhaseSkip.length,
        `${phase}フェーズスキップ推奨: 複雑度${Math.round(maxComplexity)}以下（${skipped.length}件の実績）`,
        result,
      );
    }
  }
}

/**
 * テーマ別に最適なワークフローモードを検出
 */
async function detectThemeOptimalMode(
  records: Array<{
    workflowMode: string;
    themeId: number | null;
    outcome: string;
    success: boolean;
    actualDurationMinutes: number | null;
  }>,
  result: RuleGenerationResult,
): Promise<void> {
  // テーマ別にグループ化
  const byTheme = new Map<number, typeof records>();

  for (const r of records) {
    if (r.themeId === null) continue;
    const group = byTheme.get(r.themeId) || [];
    group.push(r);
    byTheme.set(r.themeId, group);
  }

  for (const [themeId, themeRecords] of byTheme) {
    if (themeRecords.length < MIN_SAMPLES_FOR_RULE) continue;

    // モード別成功率
    const modeStats = new Map<string, { total: number; success: number; durations: number[] }>();

    for (const r of themeRecords) {
      const stats = modeStats.get(r.workflowMode) || { total: 0, success: 0, durations: [] };
      stats.total++;
      if (r.success) stats.success++;
      if (r.actualDurationMinutes) stats.durations.push(r.actualDurationMinutes);
      modeStats.set(r.workflowMode, stats);
    }

    // 最も効率的なモードを特定（成功率が高く、所要時間が短い）
    let bestMode: string | null = null;
    let bestScore = -1;

    for (const [mode, stats] of modeStats) {
      if (stats.total < 3) continue;
      const successRate = stats.success / stats.total;
      if (successRate < HIGH_SUCCESS_THRESHOLD) continue;

      const avgDuration =
        stats.durations.length > 0
          ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
          : Infinity;

      // スコア = 成功率 × (1 / 正規化された所要時間)
      const score = successRate * (1000 / Math.max(1, avgDuration));

      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }

    if (!bestMode) continue;

    // テーマで最も使われているモードと異なる場合のみルール化
    const mostUsedMode = [...modeStats.entries()].sort((a, b) => b[1].total - a[1].total)[0]?.[0];

    if (bestMode !== mostUsedMode) {
      const bestStats = modeStats.get(bestMode)!;
      const successRate = bestStats.success / bestStats.total;

      const condition = JSON.stringify({ themeId });
      const recommendation = JSON.stringify({
        action: 'set_mode',
        targetMode: bestMode,
        reason: `テーマ${themeId}では${bestMode}モードが最適（成功率${Math.round(successRate * 100)}%）`,
      });

      await upsertRule(
        'adjust_time',
        condition,
        recommendation,
        successRate,
        themeRecords.length,
        `テーマ${themeId}: ${bestMode}モード推奨（${bestStats.total}件で成功率${Math.round(successRate * 100)}%）`,
        result,
      );
    }
  }
}

/**
 * 複雑度スコアの閾値がずれているケースを検出
 */
async function detectComplexityThresholdAdjustment(
  records: Array<{
    workflowMode: string;
    predictedComplexity: number | null;
    success: boolean;
    wasOverridden: boolean;
  }>,
  result: RuleGenerationResult,
): Promise<void> {
  // lightweight判定だが実際はstandardが必要だったケース
  const lightweightFailed = records.filter(
    (r) =>
      r.workflowMode === 'lightweight' &&
      !r.success &&
      !r.wasOverridden &&
      r.predictedComplexity !== null,
  );

  if (lightweightFailed.length >= 3) {
    const complexities = lightweightFailed.map((r) => r.predictedComplexity!).sort((a, b) => a - b);
    const medianComplexity = complexities[Math.floor(complexities.length / 2)];

    // 現在の閾値(35)より低い複雑度で失敗しているなら閾値を下げるべき
    if (medianComplexity <= 35) {
      const newThreshold = Math.max(15, Math.round(medianComplexity - 5));

      const condition = JSON.stringify({
        currentThreshold: 35,
        failureComplexityMedian: medianComplexity,
      });

      const recommendation = JSON.stringify({
        action: 'adjust_threshold',
        lightweightMax: newThreshold,
        reason: `lightweight失敗が複雑度${Math.round(medianComplexity)}付近で多発（${lightweightFailed.length}件）`,
      });

      await upsertRule(
        'upgrade_mode',
        condition,
        recommendation,
        0.7,
        lightweightFailed.length,
        `lightweight閾値を${newThreshold}に引き下げ推奨（${lightweightFailed.length}件の失敗）`,
        result,
      );
    }
  }
}

/**
 * 30日以上評価されていないルールを非活性化
 */
async function deactivateStaleRules(result: RuleGenerationResult): Promise<void> {
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

// ───────────────────────────────────────────────
// タスクへの最適化提案
// ───────────────────────────────────────────────

/**
 * 新しいタスクに対してワークフロー最適化を提案する
 */
export async function getWorkflowRecommendation(
  taskId: number,
): Promise<WorkflowRecommendation | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        taskLabels: { include: { label: true } },
      },
    });

    if (!task) return null;

    // 現在の複雑度分析
    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
    };
    const analysis = analyzeTaskComplexity(complexityInput);

    // アクティブなルールを取得
    const rules = await prisma.workflowOptimizationRule.findMany({
      where: { isActive: true, confidence: { gte: CONFIDENCE_THRESHOLD } },
      orderBy: { confidence: 'desc' },
    });

    const matchedRules: WorkflowRecommendation['matchedRules'] = [];
    const reasons: string[] = [];
    let recommendedMode = analysis.recommendedMode;
    const skipPhases: string[] = [];

    for (const rule of rules) {
      const condition = JSON.parse(rule.condition);
      const recommendation = JSON.parse(rule.recommendation);

      if (matchesCondition(condition, task, analysis.complexityScore)) {
        matchedRules.push({
          ruleId: rule.id,
          description: rule.description,
          confidence: rule.confidence,
        });

        switch (recommendation.action) {
          case 'downgrade_mode':
          case 'set_mode':
            if (rule.confidence > 0.7) {
              recommendedMode = recommendation.targetMode;
              reasons.push(recommendation.reason);
            }
            break;
          case 'skip_phase':
            if (rule.confidence > 0.7) {
              skipPhases.push(recommendation.phase);
              reasons.push(recommendation.reason);
            }
            break;
          case 'adjust_threshold':
            reasons.push(recommendation.reason);
            break;
        }
      }
    }

    // 類似タスクの実績から推定時間を算出
    const estimatedDuration = await estimateDurationFromHistory(
      task.themeId,
      recommendedMode,
      analysis.complexityScore,
    );

    // ルールのlastEvaluatedを更新
    if (matchedRules.length > 0) {
      await prisma.workflowOptimizationRule.updateMany({
        where: { id: { in: matchedRules.map((r) => r.ruleId) } },
        data: { lastEvaluated: new Date() },
      });
    }

    // ルールがなくても、学習データから直接推論
    if (matchedRules.length === 0) {
      const directInsight = await getDirectInsight(task, analysis.complexityScore);
      if (directInsight) {
        recommendedMode = directInsight.mode as 'lightweight' | 'standard' | 'comprehensive';
        reasons.push(directInsight.reason);
      }
    }

    const confidence =
      matchedRules.length > 0
        ? matchedRules.reduce((sum, r) => sum + r.confidence, 0) / matchedRules.length
        : 0.5;

    return {
      taskId,
      currentMode: task.workflowMode || 'comprehensive',
      recommendedMode,
      skipPhases,
      estimatedDuration,
      confidence,
      reasons: reasons.length > 0 ? reasons : ['学習データに基づく標準推奨'],
      matchedRules,
    };
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to get workflow recommendation');
    return null;
  }
}

// ───────────────────────────────────────────────
// 統計・分析
// ───────────────────────────────────────────────

/**
 * ワークフロー学習の統計情報を取得
 */
export async function getLearningStats(): Promise<LearningStats> {
  const records = await prisma.workflowLearningRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const byMode: LearningStats['byMode'] = {};
  const byOutcome: Record<string, number> = {};
  let overrideCount = 0;
  let accuracySum = 0;
  let accuracyCount = 0;

  for (const r of records) {
    // モード別統計
    if (!byMode[r.workflowMode]) {
      byMode[r.workflowMode] = { count: 0, avgDuration: 0, successRate: 0 };
    }
    const modeStats = byMode[r.workflowMode];
    modeStats.count++;
    if (r.actualDurationMinutes) {
      modeStats.avgDuration += r.actualDurationMinutes;
    }
    if (r.success) {
      modeStats.successRate++;
    }

    // アウトカム別
    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;

    // オーバーライド率
    if (r.wasOverridden) overrideCount++;

    // 推定精度
    if (r.actualDurationMinutes && r.estimatedDuration) {
      const ratio =
        Math.min(r.actualDurationMinutes, r.estimatedDuration) /
        Math.max(r.actualDurationMinutes, r.estimatedDuration);
      accuracySum += ratio;
      accuracyCount++;
    }
  }

  // 平均化
  for (const mode of Object.keys(byMode)) {
    const stats = byMode[mode];
    if (stats.count > 0) {
      stats.avgDuration = Math.round(stats.avgDuration / stats.count);
      stats.successRate = Math.round((stats.successRate / stats.count) * 100) / 100;
    }
  }

  // 直近30日のトレンド
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRecords = records.filter((r) => r.createdAt >= thirtyDaysAgo);
  const modeDistribution: Record<string, number> = {};
  for (const r of recentRecords) {
    modeDistribution[r.workflowMode] = (modeDistribution[r.workflowMode] || 0) + 1;
  }

  return {
    totalRecords: records.length,
    byMode,
    byOutcome,
    overrideRate: records.length > 0 ? Math.round((overrideCount / records.length) * 100) / 100 : 0,
    avgAccuracy: accuracyCount > 0 ? Math.round((accuracySum / accuracyCount) * 100) / 100 : 0,
    recentTrend: {
      period: '30d',
      modeDistribution,
    },
  };
}

// ───────────────────────────────────────────────
// ヘルパー関数
// ───────────────────────────────────────────────

function calculatePhaseTimings(
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

function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'の',
    'を',
    'に',
    'は',
    'が',
    'で',
    'と',
    'する',
    'した',
    'です',
    'ます',
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'shall',
    'can',
    'for',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'from',
    'by',
    'with',
    'as',
    'of',
  ]);

  return title
    .toLowerCase()
    .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
    .slice(0, 10);
}

function detectSkippedPhases(
  workflowMode: string,
  activityLogs: Array<{ action: string; metadata: string | null }>,
): string[] {
  const skipped: string[] = [];

  // ステータス遷移の履歴から実際に通過したフェーズを特定
  const statusSet = new Set<string>();
  for (const log of activityLogs) {
    if (log.metadata) {
      try {
        const meta = JSON.parse(log.metadata);
        if (meta.newStatus) statusSet.add(meta.newStatus);
        if (meta.previousStatus) statusSet.add(meta.previousStatus);
      } catch {
        // ignore
      }
    }
  }

  // comprehensive/standardでresearchがスキップされたか
  if (
    (workflowMode === 'comprehensive' || workflowMode === 'standard') &&
    !statusSet.has('research_done')
  ) {
    skipped.push('research');
  }

  // comprehensive/standardでplanがスキップされたか
  if (
    (workflowMode === 'comprehensive' || workflowMode === 'standard') &&
    !statusSet.has('plan_created') &&
    !statusSet.has('plan_approved')
  ) {
    skipped.push('plan');
  }

  return skipped;
}

function matchesCondition(
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

async function estimateDurationFromHistory(
  themeId: number | null,
  mode: string,
  complexityScore: number,
): Promise<number> {
  const where: Record<string, unknown> = {
    workflowMode: mode,
    success: true,
    actualDurationMinutes: { not: null },
  };

  if (themeId) {
    where.themeId = themeId;
  }

  const records = await prisma.workflowLearningRecord.findMany({
    where,
    select: { actualDurationMinutes: true, predictedComplexity: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (records.length === 0) {
    // デフォルト値
    const defaults: Record<string, number> = { lightweight: 20, standard: 90, comprehensive: 210 };
    return defaults[mode] || 90;
  }

  // 複雑度が近いレコードほど重み付け
  let weightedSum = 0;
  let weightSum = 0;

  for (const r of records) {
    if (!r.actualDurationMinutes) continue;
    const diff = r.predictedComplexity ? Math.abs(complexityScore - r.predictedComplexity) : 50;
    const weight = 1 / (1 + diff / 20);
    weightedSum += r.actualDurationMinutes * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? Math.round(weightedSum / weightSum) : 90;
}

async function getDirectInsight(
  task: { themeId: number | null; workflowMode: string | null },
  complexityScore: number,
): Promise<{ mode: string; reason: string } | null> {
  // 同テーマの成功タスクの実績
  if (!task.themeId) return null;

  const themeRecords = await prisma.workflowLearningRecord.findMany({
    where: { themeId: task.themeId, success: true },
    select: { workflowMode: true, predictedComplexity: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (themeRecords.length < 3) return null;

  // 類似複雑度のタスクが最も多く使っていたモード
  const similar = themeRecords.filter(
    (r) => r.predictedComplexity && Math.abs(r.predictedComplexity - complexityScore) < 15,
  );

  if (similar.length < 3) return null;

  const modeCount: Record<string, number> = {};
  for (const r of similar) {
    modeCount[r.workflowMode] = (modeCount[r.workflowMode] || 0) + 1;
  }

  const bestMode = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0];

  if (bestMode && bestMode[0] !== task.workflowMode) {
    return {
      mode: bestMode[0],
      reason: `同テーマの類似タスク${similar.length}件中${bestMode[1]}件が${bestMode[0]}モードで成功`,
    };
  }

  return null;
}

async function upsertRule(
  ruleType: string,
  condition: string,
  recommendation: string,
  confidence: number,
  sampleSize: number,
  description: string,
  result: RuleGenerationResult,
): Promise<void> {
  // 同条件の既存ルールを検索
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
