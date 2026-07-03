/**
 * hypothesis routes
 *
 * HTTP API for the 仮説台帳 (Hypothesis Ledger). Used by AI agents (which file
 * conjectures via POST /hypotheses and record evidence via
 * POST /hypotheses/:id/evidence during research/implement/verify) and by the UI.
 * Hypotheses NEVER spawn tasks — they are tested opportunistically and graduate
 * to validated knowledge only with concrete evidence.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  submitHypothesis,
  addEvidence,
  listHypotheses,
  getHypothesis,
  setHypothesisStatus,
  deleteHypothesis,
  getHypothesisStats,
  normalizeDomain,
  type HypothesisStatus,
  type EvidenceStance,
} from '../../services/memory/hypothesis-service';

const log = createLogger('routes:hypothesis');

export const hypothesisRoutes = new Elysia()
  /** List hypotheses with optional filters (default: open). */
  .get(
    '/hypotheses',
    async ({ query }) => {
      const status = (query.status as HypothesisStatus | 'all' | undefined) ?? 'open';
      const domain = query.domain ? normalizeDomain(query.domain) : undefined;
      const themeId = query.themeId ? parseInt(query.themeId) : undefined;
      const limit = query.limit ? parseInt(query.limit) : 20;
      const offset = query.offset ? parseInt(query.offset) : 0;
      return listHypotheses({ status, domain, themeId, limit, offset });
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  /** Hypothesis counts by status. */
  .get('/hypotheses/stats', async () => getHypothesisStats())

  /** Fetch one hypothesis (with its evidence trail). */
  .get('/hypotheses/:id', async ({ params, set }) => {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) {
      set.status = 400;
      return { error: '無効なIDです' };
    }
    const hyp = await getHypothesis(id);
    if (!hyp) {
      set.status = 404;
      return { error: '仮説が見つかりません' };
    }
    return hyp;
  })

  /** File a new hypothesis. Rejected (422) when not falsifiable. */
  .post(
    '/hypotheses',
    async ({ body, set }) => {
      if (!body.statement?.trim() || !body.rationale?.trim()) {
        set.status = 400;
        return { error: '命題 (statement) と根拠 (rationale) は必須です' };
      }
      const result = await submitHypothesis({
        statement: body.statement.trim(),
        rationale: body.rationale.trim(),
        domain: normalizeDomain(body.domain),
        themeId: body.themeId ?? undefined,
        originTaskId: body.originTaskId ?? undefined,
        source: body.source ?? 'agent',
      });
      if (!result.ok) {
        // Not falsifiable → 422 so the agent revises rather than retries blindly.
        set.status = 422;
        return { error: result.reason };
      }
      return { success: true, id: result.id };
    },
    {
      body: t.Object({
        statement: t.String(),
        rationale: t.String(),
        domain: t.Optional(t.String()),
        themeId: t.Optional(t.Number()),
        originTaskId: t.Optional(t.Number()),
        source: t.Optional(t.String()),
      }),
    },
  )

  /** Record a piece of evidence for/against a hypothesis. */
  .post(
    '/hypotheses/:id/evidence',
    async ({ params, body, set }) => {
      const id = parseInt(params.id);
      if (!Number.isFinite(id)) {
        set.status = 400;
        return { error: '無効なIDです' };
      }
      if (!body.detail?.trim() || !body.artifact?.trim()) {
        set.status = 400;
        return { error: '観察 (detail) と具体的根拠 (artifact) は必須です' };
      }
      const result = await addEvidence(id, {
        stance: body.stance as EvidenceStance,
        detail: body.detail.trim(),
        artifact: body.artifact.trim(),
        taskId: body.taskId ?? null,
        phase: body.phase ?? null,
      });
      if (!result.ok) {
        // Rejected by the evidence gate (hand-wavy artifact) → 422.
        set.status = 422;
        return { error: result.reason };
      }
      return {
        success: true,
        confidence: result.confidence,
        status: result.status,
        graduated: result.graduated,
      };
    },
    {
      body: t.Object({
        stance: t.String(),
        detail: t.String(),
        artifact: t.String(),
        taskId: t.Optional(t.Number()),
        phase: t.Optional(t.String()),
      }),
    },
  )

  /** Manually override a hypothesis's status. */
  .put(
    '/hypotheses/:id/status',
    async ({ params, body, set }) => {
      const id = parseInt(params.id);
      if (!Number.isFinite(id)) {
        set.status = 400;
        return { error: '無効なIDです' };
      }
      const ok = await setHypothesisStatus(id, body.status as HypothesisStatus);
      if (!ok) {
        set.status = 404;
        return { error: '仮説が見つかりません' };
      }
      return { success: true };
    },
    { body: t.Object({ status: t.String() }) },
  )

  /** Delete a hypothesis. */
  .delete(
    '/hypotheses/:id',
    async ({ params, set }) => {
      const id = parseInt(params.id);
      if (!Number.isFinite(id)) {
        set.status = 400;
        return { error: '無効なIDです' };
      }
      const ok = await deleteHypothesis(id);
      if (!ok) {
        set.status = 404;
        return { error: '仮説が見つかりません' };
      }
      log.info({ id }, 'Hypothesis deleted');
      return { success: true };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
