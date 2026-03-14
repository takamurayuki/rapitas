/**
 * ローカルLLM管理ルート
 * Ollama / llama-server の状態確認、モデルダウンロード等
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
} from '../../services/local-llm';

const log = createLogger('routes:local-llm');

export const localLLMRouter = new Elysia({ prefix: '/local-llm' })

  // ローカルLLMの状態取得
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

  // モデルのダウンロード開始
  .post('/download-model', async ({ set }) => {
    try {
      const progress = getDownloadProgress();
      if (progress.status === 'downloading') {
        set.status = 409;
        return { error: 'ダウンロードが既に進行中です', progress };
      }

      // 非同期でダウンロード開始（即座にレスポンスを返す）
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

  // ダウンロード進捗取得
  .get('/download-progress', () => {
    return getDownloadProgress();
  })

  // モデル削除
  .delete('/model', ({ set }) => {
    const deleted = deleteModel();
    if (!deleted) {
      set.status = 404;
      return { error: 'モデルが見つかりません' };
    }
    return { message: 'モデルを削除しました' };
  })

  // ローカルLLMの接続テスト
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
  );
