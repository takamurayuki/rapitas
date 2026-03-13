/**
 * Intelligent Suggestions Routes
 * 予測型タスク提案、ナレッジリマインド、知識共有のAPIエンドポイント
 */
import { Elysia } from 'elysia';
import { parseId } from '../../middleware/error-handler';
import { createLogger } from '../../config/logger';
import {
  getSuggestedTasks,
  getProductivityHeatmap,
  getHeatmapCellTasks,
} from '../../services/predictive-task-suggester';
import {
  scanAndRemind,
  markAsReviewed,
  getReminderSummary,
} from '../../services/memory/knowledge-reminder';
import {
  extractKnowledgeFromTask,
  findRelatedKnowledge,
} from '../../services/memory/task-knowledge-extractor';
import {
  gatherSharedKnowledge,
  formatKnowledgeContext,
} from '../../services/agents/agent-knowledge-sharing';

const log = createLogger('routes:intelligent-suggestions');

export const intelligentSuggestionsRoutes = new Elysia({ prefix: '/intelligence' })

  // ─── 予測型タスク提案 ───

  // 今やるべきタスクの提案を取得
  .get('/suggested-tasks', async ({ query }) => {
    try {
      const limit = Math.min(parseInt(query?.limit || '5', 10), 20);
      const result = await getSuggestedTasks(limit);
      return { success: true, ...result };
    } catch (err) {
      log.error({ err }, 'Error getting suggested tasks');
      throw err;
    }
  })

  // 生産性ヒートマップを取得
  .get('/productivity-heatmap', async ({ query }) => {
    try {
      const days = Math.min(Math.max(parseInt(query?.days || '90', 10), 7), 365);
      const result = await getProductivityHeatmap(days);
      return { success: true, ...result };
    } catch (err) {
      log.error({ err }, 'Error getting productivity heatmap');
      throw err;
    }
  })

  // ヒートマップセルの詳細タスク一覧
  .get('/productivity-heatmap/tasks', async ({ query }) => {
    try {
      const day = parseInt(query?.day || '0', 10);
      const hour = parseInt(query?.hour || '0', 10);
      const days = Math.min(Math.max(parseInt(query?.days || '90', 10), 7), 365);
      const tasks = await getHeatmapCellTasks(day, hour, days);
      return { success: true, tasks };
    } catch (err) {
      log.error({ err }, 'Error getting heatmap cell tasks');
      throw err;
    }
  })

  // ─── ナレッジ自動リマインド ───

  // リマインドスキャンを実行
  .post('/knowledge-reminders/scan', async () => {
    try {
      const result = await scanAndRemind();
      return { success: true, ...result };
    } catch (err) {
      log.error({ err }, 'Error scanning knowledge reminders');
      throw err;
    }
  })

  // リマインドサマリーを取得（ダッシュボード用）
  .get('/knowledge-reminders/summary', async () => {
    try {
      const summary = await getReminderSummary();
      return { success: true, ...summary };
    } catch (err) {
      log.error({ err }, 'Error getting reminder summary');
      throw err;
    }
  })

  // ナレッジを復習済みとしてマーク
  .post('/knowledge-reminders/:entryId/review', async ({ params }) => {
    try {
      const entryId = parseId(params.entryId, 'entry ID');
      const result = await markAsReviewed(entryId);
      return result;
    } catch (err) {
      log.error({ err }, 'Error marking knowledge as reviewed');
      throw err;
    }
  })

  // ─── タスク完了→ナレッジ自動抽出 ───

  // タスクからナレッジを手動抽出
  .post('/tasks/:taskId/extract-knowledge', async ({ params }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');
      const entryIds = await extractKnowledgeFromTask(taskId);
      return {
        success: true,
        entriesCreated: entryIds.length,
        entryIds,
      };
    } catch (err) {
      log.error({ err }, 'Error extracting knowledge from task');
      throw err;
    }
  })

  // タスクに関連するナレッジを検索
  .get('/tasks/related-knowledge', async ({ query }) => {
    try {
      const title = query?.title || '';
      const description = query?.description || null;
      const themeId = query?.themeId ? parseInt(query.themeId, 10) : null;
      const limit = Math.min(parseInt(query?.limit || '5', 10), 20);

      if (!title) {
        return { success: true, entries: [] };
      }

      const entries = await findRelatedKnowledge(title, description, themeId, limit);
      return { success: true, entries };
    } catch (err) {
      log.error({ err }, 'Error finding related knowledge');
      throw err;
    }
  })

  // ─── エージェント間知識共有 ───

  // タスク実行前の共有知識を取得
  .get('/tasks/:taskId/agent-context', async ({ params }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');
      const knowledge = await gatherSharedKnowledge(taskId);
      const contextText = formatKnowledgeContext(knowledge);

      return {
        success: true,
        knowledge,
        contextText,
        hasRelevantData:
          knowledge.patterns.length > 0 ||
          knowledge.relevantKnowledge.length > 0 ||
          knowledge.warnings.length > 0,
      };
    } catch (err) {
      log.error({ err }, 'Error getting agent context');
      throw err;
    }
  });
