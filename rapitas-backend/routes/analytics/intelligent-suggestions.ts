/**
 * Intelligent Suggestions Routes
 * Predictive task suggestions, knowledge reminders, and knowledge sharing endpoints.
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

  // ─── Predictive Task Suggestions ───

  // Get suggested tasks to work on now
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

  // Get productivity heatmap
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

  // Get detailed task list for a heatmap cell
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

  // ─── Knowledge Auto-Reminders ───

  // Execute a reminder scan
  .post('/knowledge-reminders/scan', async () => {
    try {
      const result = await scanAndRemind();
      return { success: true, ...result };
    } catch (err) {
      log.error({ err }, 'Error scanning knowledge reminders');
      throw err;
    }
  })

  // Get reminder summary (for dashboard)
  .get('/knowledge-reminders/summary', async () => {
    try {
      const summary = await getReminderSummary();
      return { success: true, ...summary };
    } catch (err) {
      log.error({ err }, 'Error getting reminder summary');
      throw err;
    }
  })

  // Mark knowledge entry as reviewed
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

  // ─── Task Completion → Knowledge Extraction ───

  // Manually extract knowledge from a task
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

  // Search for knowledge related to a task
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

  // ─── Agent Knowledge Sharing ───

  // Get shared knowledge context before task execution
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
