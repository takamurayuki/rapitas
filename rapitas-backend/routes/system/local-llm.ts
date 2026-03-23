/**
 * Local LLM Management Routes
 * Status checks, model downloads, and connection tests for Ollama / llama-server.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  getLocalLLMStatus,
  ensureLocalLLM,
  downloadModel,
  getDownloadProgress,
  isModelDownloaded,
  deleteModel,
  getCacheStats,
  purgeExpiredEntries,
  getTeachingStats,
} from '../../services/local-llm';
import {
  delegateToLocalLLM,
  getAvailableDelegationTasks,
  type DelegationTaskType,
} from '../../services/local-llm/mcp-delegation-tool';

const log = createLogger('routes:local-llm');

export const localLLMRouter = new Elysia({ prefix: '/local-llm' })

  // Get local LLM status
  .get('/status', async () => {
    try {
      const status = await getLocalLLMStatus();
      return status;
    } catch (error) {
      log.error({ err: error }, 'Failed to get local LLM status');
      return {
        available: false,
        source: 'none' as const,
        url: '',
        model: '',
        models: [],
        modelDownloaded: isModelDownloaded(),
        llamaServerRunning: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // Start model download
  .post('/download-model', async ({ set }) => {
    try {
      const progress = getDownloadProgress();
      if (progress.status === 'downloading') {
        set.status = 409;
        return { error: 'ダウンロードが既に進行中です', progress };
      }

      // Fire-and-forget — return response immediately
      downloadModel().catch((err) => {
        log.error({ err }, 'Model download failed');
      });

      return { message: 'ダウンロードを開始しました', progress: getDownloadProgress() };
    } catch (error) {
      log.error({ err: error }, 'Failed to start model download');
      set.status = 500;
      return { error: 'ダウンロードの開始に失敗しました' };
    }
  })

  // Get download progress
  .get('/download-progress', () => {
    return getDownloadProgress();
  })

  // Delete model
  .delete('/model', ({ set }) => {
    const deleted = deleteModel();
    if (!deleted) {
      set.status = 404;
      return { error: 'モデルが見つかりません' };
    }
    return { message: 'モデルを削除しました' };
  })

  // Test local LLM connection
  .post(
    '/test-connection',
    async ({ body }) => {
      const { url } = body;
      try {
        const result = await ensureLocalLLM(url || undefined);
        if (result) {
          return {
            success: true,
            url: result.url,
            model: result.model,
            message: '接続に成功しました',
          };
        }
        return {
          success: false,
          message: 'ローカルLLMに接続できません。Ollamaが起動しているか確認してください。',
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : '接続テストに失敗しました',
        };
      }
    },
    {
      body: t.Object({
        url: t.Optional(t.String()),
      }),
    },
  )

  // --- MCP Delegation Endpoints ---

  // List available delegation task types
  .get('/delegate/tasks', () => {
    return getAvailableDelegationTasks();
  })

  // Delegate a sub-task to local LLM
  .post(
    '/delegate',
    async ({ body, set }) => {
      try {
        const result = await delegateToLocalLLM({
          taskType: body.taskType as DelegationTaskType,
          input: body.input,
          evaluate: body.evaluate ?? false,
          themeId: body.themeId,
        });
        return result;
      } catch (error) {
        log.error({ err: error }, 'Delegation failed');
        set.status = 500;
        return { error: error instanceof Error ? error.message : 'Delegation failed' };
      }
    },
    {
      body: t.Object({
        taskType: t.String(),
        input: t.String(),
        evaluate: t.Optional(t.Boolean()),
        themeId: t.Optional(t.Number()),
      }),
    },
  )

  // --- Cache & Teaching Stats ---

  // Get response cache statistics
  .get('/cache/stats', () => {
    try {
      return getCacheStats();
    } catch {
      return { totalEntries: 0, totalHits: 0, totalMisses: 0, hitRate: 0, oldestEntry: null, cacheSize: 0 };
    }
  })

  // Purge expired cache entries
  .post('/cache/purge', () => {
    const purged = purgeExpiredEntries();
    return { purged };
  })

  // Get teaching material statistics
  .get('/teaching/stats', async () => {
    try {
      return await getTeachingStats();
    } catch (error) {
      log.error({ err: error }, 'Failed to get teaching stats');
      return [];
    }
  });
