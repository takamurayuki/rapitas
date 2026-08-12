/**
 * HypothesisExperiments API
 *
 * HTTP entry points for the hypothesis-driven self-experiment loop: create an
 * experiment from a ledger hypothesis, inspect the active experiment and
 * history, and abort manually. Prefix /hypothesis-experiments — deliberately
 * distinct from the legacy per-task /experiments scaffold (different
 * semantics; that code is untouched). Progress/judgement is driven by the
 * outcome-telemetry hook, not by these routes.
 */
import { Elysia, t } from 'elysia';
import {
  abortExperiment,
  createExperimentFromHypothesis,
} from '../../services/self-learning/experiment-loop/experiment-lifecycle';
import {
  listExperimentHistory,
  readActiveExperiment,
} from '../../services/self-learning/experiment-loop/experiment-store';

export const hypothesisExperimentsRoutes = new Elysia({ prefix: '/hypothesis-experiments' })
  // Active experiment + terminal history (observability view).
  .get('/', () => ({
    active: readActiveExperiment(),
    history: listExperimentHistory(),
  }))

  .get('/active', () => ({ active: readActiveExperiment() }))

  // Start an experiment from an open agent-behavior hypothesis. 409 when one
  // is already running (at most one concurrent experiment), 400 otherwise.
  .post(
    '/',
    async ({ body, set }) => {
      const result = await createExperimentFromHypothesis(
        body.hypothesisId,
        body.role,
        body.addendum,
      );
      if (!result.ok) {
        set.status = result.reason?.includes('同時実験は1本まで') ? 409 : 400;
      }
      return result;
    },
    {
      body: t.Object({
        hypothesisId: t.Number(),
        role: t.String(),
        addendum: t.String(),
      }),
    },
  )

  // Manual abort: clears the active experiment without judgement.
  .post('/abort', ({ set }) => {
    const aborted = abortExperiment();
    if (!aborted) set.status = 404;
    return aborted
      ? { ok: true }
      : { ok: false, reason: 'アクティブな実験がありません' };
  });
