/**
 * miss-signatures routes
 *
 * HTTP API for the detection-miss learning loop: list suggestions, read the
 * approval-mode summary, and record human approve/reject verdicts. Thin
 * layer — all lifecycle rules live in miss-signature-service.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  listSuggestions,
  reviewSuggestion,
  getMissSummary,
} from '../../services/self-improvement/miss-signature-service';

const log = createLogger('routes:miss-signatures');

export const missSignaturesRoutes = new Elysia({ prefix: '/self-improvement/miss-signatures' })
  /** List suggestions (default: the pending review queue, oldest first). */
  .get(
    '/',
    async ({ query }) => {
      return { suggestions: await listSuggestions(query.status || 'pending_review') };
    },
    { query: t.Object({ status: t.Optional(t.String()) }) },
  )

  /** Current approval mode (derived, stateless) + verdict/queue counts. */
  .get('/summary', async ({ set }) => {
    try {
      return { success: true, summary: await getMissSummary() };
    } catch (err) {
      log.error({ err }, 'Failed to build miss summary');
      set.status = 500;
      return { success: false, error: 'サマリの取得に失敗しました' };
    }
  })

  /** Record a human verdict. 404 when the row is missing or not reviewable. */
  .post(
    '/:id/review',
    async ({ params, body, set }) => {
      const id = parseInt(params.id, 10);
      if (!Number.isInteger(id)) {
        set.status = 400;
        return { error: 'id が不正です' };
      }
      const ok = await reviewSuggestion(id, body.approved);
      if (!ok) {
        set.status = 404;
        return { error: '提案が見つからないか、レビュー可能な状態ではありません' };
      }
      return { success: true, approved: body.approved };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ approved: t.Boolean() }),
    },
  );
