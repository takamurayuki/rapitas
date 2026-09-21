/**
 * pr-risk routes
 *
 * HTTP API for PR merge-failure risk prediction: read/change the rollout stage
 * and threshold, register operator-confirmed critical incidents (a failure
 * label source), and list monthly precision/recall/FPR + threshold reviews.
 * Thin layer — logic lives in services/self-improvement/pr-risk.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  defaultDb,
  listRecentMetrics,
  readConfig,
  registerIncident,
  writeConfig,
  type PrRiskDb,
} from '../../services/self-improvement/pr-risk/pr-risk-store';
import { toStage } from '../../services/self-improvement/pr-risk/pr-risk-types';

const log = createLogger('routes:pr-risk');

const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

const publicConfig = (c: Awaited<ReturnType<typeof readConfig>>) => ({
  stage: c.stage,
  threshold: c.threshold,
  modelVersion: c.modelVersion,
  stageChangedAt: c.stageChangedAt,
});

/**
 * Build the PR-risk routes over a database (injectable for tests).
 *
 * @param db - PrRiskDb implementation / DB
 * @returns Elysia plugin / ルート
 */
export function createPrRiskRoutes(db: PrRiskDb) {
  return new Elysia({ prefix: '/self-improvement/pr-risk' })
    .get('/config', async ({ set }) => {
      try {
        return { success: true, ...publicConfig(await readConfig(db)) };
      } catch (err) {
        log.error({ err }, 'Failed to read pr-risk config');
        set.status = 500;
        return { success: false, error: '設定の取得に失敗しました' };
      }
    })
    .put(
      '/config',
      async ({ body, set }) => {
        const stage = body.stage === undefined ? undefined : toStage(body.stage);
        const threshold = body.threshold;
        if (stage === null) {
          set.status = 422;
          return { success: false, error: 'stage は off / display / hold / auto のいずれかです' };
        }
        if (
          threshold !== undefined &&
          (typeof threshold !== 'number' || !(threshold > 0 && threshold < 1))
        ) {
          set.status = 422;
          return { success: false, error: 'threshold は 0 より大きく 1 未満の数値です' };
        }
        try {
          const current = await readConfig(db);
          // Automatic judgement on an untrained prior would act on no evidence.
          if (stage === 'auto' && current.modelVersion === 0) {
            set.status = 409;
            return {
              success: false,
              error: '未学習のモデルでは auto に移行できません（月次ジョブの学習後に再試行）',
            };
          }
          const next = await writeConfig(db, {
            ...(stage !== undefined && stage !== current.stage
              ? { stage, stageChangedAt: new Date() }
              : {}),
            ...(threshold !== undefined ? { threshold } : {}),
          });
          return { success: true, ...publicConfig(next) };
        } catch (err) {
          log.error({ err }, 'Failed to update pr-risk config');
          set.status = 500;
          return { success: false, error: '設定の更新に失敗しました' };
        }
      },
      { body: t.Object({ stage: t.Optional(t.Unknown()), threshold: t.Optional(t.Unknown()) }) },
    )
    .post(
      '/incidents',
      async ({ body, set }) => {
        const { repo, prNumber, note } = body;
        if (
          typeof repo !== 'string' ||
          !REPO_PATTERN.test(repo) ||
          typeof prNumber !== 'number' ||
          !Number.isInteger(prNumber) ||
          prNumber <= 0 ||
          typeof note !== 'string' ||
          note.trim() === ''
        ) {
          set.status = 422;
          return {
            success: false,
            error: 'repo（owner/repo）・prNumber（正の整数）・note は必須です',
          };
        }
        try {
          await registerIncident(db, { repo, prNumber, note: note.trim(), now: new Date() });
          return { success: true };
        } catch (err) {
          log.error({ err }, 'Failed to register pr-risk incident');
          set.status = 500;
          return { success: false, error: '障害の登録に失敗しました' };
        }
      },
      {
        body: t.Object({
          repo: t.Optional(t.Unknown()),
          prNumber: t.Optional(t.Unknown()),
          note: t.Optional(t.Unknown()),
        }),
      },
    )
    .get('/metrics', async ({ set }) => {
      try {
        return { success: true, ...(await listRecentMetrics(db)) };
      } catch (err) {
        log.error({ err }, 'Failed to list pr-risk metrics');
        set.status = 500;
        return { success: false, error: '指標の取得に失敗しました' };
      }
    });
}

const prRiskRoutes = createPrRiskRoutes(defaultDb);

export default prRiskRoutes;
