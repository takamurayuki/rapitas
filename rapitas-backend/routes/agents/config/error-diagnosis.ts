/**
 * Error Diagnosis Route
 *
 * Read-only list of LLM-assisted error diagnoses (task 612) plus a summary,
 * and a write endpoint for operator feedback on whether a diagnosis was
 * helpful. Not responsible for producing diagnoses — see
 * services/ai/error-diagnosis/diagnose-error.ts.
 */
import { Elysia, t } from 'elysia';
import {
  aggregate,
  readDiagnoses,
  readFeedback,
  recordFeedback,
} from '../../../services/ai/error-diagnosis';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound for ?windowDays= so a typo can't force a full-history scan window. */
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 45;

function resolveWindowDays(requestedRaw: string | undefined): number {
  const requested = requestedRaw !== undefined ? Number(requestedRaw) : NaN;
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
    : DEFAULT_WINDOW_DAYS;
}

export const errorDiagnosisRoutes = new Elysia()
  .get(
    '/agents/error-diagnosis',
    ({ query }) => {
      const windowDays = resolveWindowDays(query.windowDays);
      const nowMs = Date.now();
      const diagnoses = readDiagnoses(nowMs - windowDays * DAY_MS);
      const feedback = readFeedback();
      const feedbackByDiagnosisId = new Map(feedback.map((f) => [f.diagnosisId, f]));

      return {
        diagnoses: diagnoses.map((d) => {
          const f = feedbackByDiagnosisId.get(d.id);
          const feedbackStatus: 'helpful' | 'not_helpful' | null = f
            ? f.helpful
              ? 'helpful'
              : 'not_helpful'
            : null;
          return { ...d, feedback: feedbackStatus };
        }),
        summary: aggregate(diagnoses, feedback),
        windowDays,
        generatedAtMs: nowMs,
      };
    },
    {
      query: t.Object({ windowDays: t.Optional(t.String()) }),
    },
  )
  .post(
    '/agents/error-diagnosis/:id/feedback',
    ({ params, body, set }) => {
      const exists = readDiagnoses().some((d) => d.id === params.id);
      if (!exists) {
        set.status = 404;
        return { error: 'diagnosis_not_found' };
      }
      recordFeedback(
        { diagnosisId: params.id, helpful: body.helpful, note: body.note ?? null },
        Date.now(),
      );
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ helpful: t.Boolean(), note: t.Optional(t.String()) }),
    },
  );
