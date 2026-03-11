/**
 * Workflow Learning Routes
 * ワークフロー学習最適化のAPIエンドポイント
 */
import { Elysia } from 'elysia';
import { parseId } from '../../middleware/error-handler';
import { createLogger } from '../../config/logger';
import { prisma } from '../../config';
import {
  generateOptimizationRules,
  getWorkflowRecommendation,
  getLearningStats,
} from '../../services/workflow/workflow-learning-optimizer';

const log = createLogger('routes:workflow-learning');

export const workflowLearningRoutes = new Elysia({ prefix: '/workflow/learning' })

  // タスクへのワークフロー最適化提案を取得
  .get('/tasks/:taskId/recommendation', async ({ params }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const recommendation = await getWorkflowRecommendation(taskId);

      if (!recommendation) {
        return {
          success: true,
          recommendation: null,
          message: 'タスクが見つからないか、推奨データがありません',
        };
      }

      return {
        success: true,
        recommendation,
      };
    } catch (err) {
      log.error({ err }, 'Error getting workflow recommendation');
      throw err;
    }
  })

  // ワークフロー学習の統計情報を取得
  .get('/stats', async () => {
    try {
      const stats = await getLearningStats();

      return {
        success: true,
        stats,
      };
    } catch (err) {
      log.error({ err }, 'Error getting learning stats');
      throw err;
    }
  })

  // アクティブな最適化ルール一覧を取得
  .get('/rules', async ({ query }) => {
    try {
      const includeInactive = query?.includeInactive === 'true';

      const rules = await prisma.workflowOptimizationRule.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ confidence: 'desc' }, { sampleSize: 'desc' }],
      });

      return {
        success: true,
        rules: rules.map((r) => ({
          ...r,
          condition: JSON.parse(r.condition),
          recommendation: JSON.parse(r.recommendation),
        })),
        totalActive: rules.filter((r) => r.isActive).length,
        totalInactive: rules.filter((r) => !r.isActive).length,
      };
    } catch (err) {
      log.error({ err }, 'Error getting optimization rules');
      throw err;
    }
  })

  // 最適化ルールの自動生成を実行
  .post('/rules/generate', async () => {
    try {
      const result = await generateOptimizationRules();

      return {
        success: true,
        result,
      };
    } catch (err) {
      log.error({ err }, 'Error generating optimization rules');
      throw err;
    }
  })

  // 特定のルールを有効化/無効化
  .patch('/rules/:ruleId', async ({ params, body }) => {
    try {
      const ruleId = parseId(params.ruleId, 'rule ID');
      const parsedBody = body as { isActive?: boolean };

      const rule = await prisma.workflowOptimizationRule.update({
        where: { id: ruleId },
        data: {
          ...(typeof parsedBody?.isActive === 'boolean' && { isActive: parsedBody.isActive }),
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        rule: {
          ...rule,
          condition: JSON.parse(rule.condition),
          recommendation: JSON.parse(rule.recommendation),
        },
      };
    } catch (err) {
      log.error({ err }, 'Error updating optimization rule');
      throw err;
    }
  })

  // 学習記録一覧を取得（デバッグ・分析用）
  .get('/records', async ({ query }) => {
    try {
      const limit = Math.min(parseInt(query?.limit || '50', 10), 200);
      const offset = parseInt(query?.offset || '0', 10);
      const themeId = query?.themeId ? parseInt(query.themeId, 10) : undefined;
      const mode = query?.mode;

      const where: Record<string, unknown> = {};
      if (themeId) where.themeId = themeId;
      if (mode) where.workflowMode = mode;

      const [records, total] = await Promise.all([
        prisma.workflowLearningRecord.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            task: { select: { id: true, title: true, status: true } },
          },
        }),
        prisma.workflowLearningRecord.count({ where }),
      ]);

      return {
        success: true,
        records: records.map((r) => ({
          ...r,
          skippedPhases: JSON.parse(r.skippedPhases),
          phaseTimings: JSON.parse(r.phaseTimings),
          labels: JSON.parse(r.labels),
          titleKeywords: JSON.parse(r.titleKeywords),
          complexityFactors: JSON.parse(r.complexityFactors),
        })),
        total,
        limit,
        offset,
      };
    } catch (err) {
      log.error({ err }, 'Error getting learning records');
      throw err;
    }
  })

  // 推奨を適用（ワークフローモードを更新）
  .post('/tasks/:taskId/apply-recommendation', async ({ params }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const recommendation = await getWorkflowRecommendation(taskId);

      if (!recommendation) {
        return { success: false, message: '推奨データがありません' };
      }

      // 信頼度が低い場合は警告
      if (recommendation.confidence < 0.6) {
        return {
          success: false,
          message: `信頼度が低いため自動適用できません（${Math.round(recommendation.confidence * 100)}%）`,
          recommendation,
        };
      }

      // モード変更を適用
      if (recommendation.recommendedMode !== recommendation.currentMode) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            workflowMode: recommendation.recommendedMode,
            updatedAt: new Date(),
          },
        });

        // ActivityLog に記録
        await prisma.activityLog.create({
          data: {
            taskId,
            action: 'workflow_mode_auto_optimized',
            metadata: JSON.stringify({
              previousMode: recommendation.currentMode,
              newMode: recommendation.recommendedMode,
              confidence: recommendation.confidence,
              reasons: recommendation.reasons,
              matchedRules: recommendation.matchedRules.map((r) => r.ruleId),
            }),
            createdAt: new Date(),
          },
        });
      }

      return {
        success: true,
        applied: {
          mode: recommendation.recommendedMode,
          skipPhases: recommendation.skipPhases,
          estimatedDuration: recommendation.estimatedDuration,
          confidence: recommendation.confidence,
        },
        recommendation,
      };
    } catch (err) {
      log.error({ err }, 'Error applying recommendation');
      throw err;
    }
  });
