/**
 * requirement-intake-outcome
 *
 * Classifies why a requirement-intake run filed nothing for a theme, and
 * reports the classifications that mean work has silently stopped. Owns only
 * the classification and the report — it does not read requirements, file
 * tasks, or decide the throttle.
 *
 * Why it exists (F1). The job returned a bare count, so "0 because every
 * feature is already filed" and "0 because this theme can never file anything
 * again" were the same number. Measured 2026-10-14: TempoRaid has a
 * requirements.md, a manifest, 16 tasks of which 15 are done and 1 cancelled —
 * zero outstanding work — and NO preview config, neither in
 * `Theme.runtimeConfigJson` (empty string) nor as `rapitas.runtime.json` on the
 * authoritative branch. Both of its environment-setup tasks (#1153, #1213) are
 * already `done`. So needsEnvironmentBootstrap stays true forever, the
 * already-filed check suppresses re-filing, intake returns 0 on every daily
 * run, and the theme sits idle with its remaining features never filed. The
 * only trace is one WARN line.
 *
 * ContextFlow has the same empty `runtimeConfigJson` but does carry
 * `rapitas.runtime.json` on disk, so it takes the normal path — which is why
 * the config check, not the column, decides this. It is still stopped, for the
 * other reason: 5 unstarted tasks against a cap of 3, with 5 declared features
 * unfiled. Both live themes are stuck, each in a different way, and neither
 * said so anywhere.
 *
 * Two kinds are deliberately NOT stalls, and the measurement is what decided
 * it. Running this classifier over the whole fleet (8 themes with a live
 * working directory) with "no requirements document" and "no `[F-NN]`
 * declared" treated as stalls reported 7 of the 8 — noise, not a signal:
 *
 *   requirements_missing  rapitas, tripla, UIカタログ, trendline
 *   no_features_declared  fusen, コンバーター
 *
 * None of those is a stalled document-driven project. rapitas is this repo
 * itself; the other three simply have no requirements document and never did,
 * and nothing distinguishes "lost its document" from "never had one". fusen
 * and コンバーター do have documents, in a style that uses no `[F-NN]` labels,
 * while their tasks progress normally (4 done, and 12 done + 2 todo). A
 * detector that fires on six healthy themes every day is how the real signals
 * get ignored, so only the two kinds with an actual dead end report: 2 of 8
 * after the correction — TempoRaid (environment_pending) and ContextFlow
 * (throttled).
 */
import { createLogger } from '../../config/logger';
import { logCycleEvent } from '../observability';
import { notifyOncePerWindow } from '../communication/notify-once-per-window';
import { SPEC_GATE_TASK_PREFIX } from '../organization/spec-gate-task';

const log = createLogger('scheduling:requirement-intake');

/** Why a theme's intake run ended where it did. */
export type IntakeOutcomeKind =
  /** Tasks were filed — progress. */
  | 'filed'
  /** The requirements document could not be read. */
  | 'requirements_missing'
  /** The document was read but declares no `[F-NN]` feature. */
  | 'no_features_declared'
  /** Environment setup is already filed and the project still lacks preview config. */
  | 'environment_pending'
  /** Features are waiting only because the outstanding-backlog cap is full. */
  | 'throttled'
  /** The document still carries an error-severity finding, so nothing may be filed. */
  | 'spec_incomplete'
  /** Every declared feature already has a task — nothing to do. */
  | 'all_filed';

/** One theme's outcome. */
export interface IntakeOutcome {
  themeId: number;
  kind: IntakeOutcomeKind;
  filed: number;
  /** Features declared but not yet filed, when known. / 未起票の機能数 */
  pending?: number;
  /** Outstanding tasks counted against the cap, when known. / 未着手件数 */
  unstarted?: number;
  /** The cap `unstarted` was compared against. / 上限 */
  cap?: number;
  /** True when the environment-setup task is already finished. / 環境構築タスクが完了済みか */
  setupDone?: boolean;
  /** Error-severity spec findings holding the features back. / 起票を止めている不備の件数 */
  blocking?: number;
}

/**
 * Whether this outcome means work has stopped with nothing reporting it.
 *
 * Only the two kinds with a dead end qualify. `all_filed` is working as
 * designed; `requirements_missing` and `no_features_declared` describe themes
 * that are not document-driven at all (see the module note's 7-of-8
 * measurement). `environment_pending` counts only once the setup task is
 * FINISHED — while it is still open the theme is legitimately waiting for it.
 *
 * @param outcome - The classified outcome. / 判定結果
 * @returns Whether to report it. / 報告対象か
 */
export function isSilentStall(outcome: IntakeOutcome): boolean {
  switch (outcome.kind) {
    case 'throttled':
      return true;
    case 'environment_pending':
      return outcome.setupDone === true;
    case 'spec_incomplete':
      // Filing the gate task IS the report on the run that creates it. It
      // becomes a stall on the runs after that, when the task is open and
      // every feature is still held — the state nobody would otherwise see.
      return outcome.filed === 0;
    default:
      return false;
  }
}

/** Human-readable reason, used for both the cycle event and the notification. */
export function describeIntakeOutcome(outcome: IntakeOutcome): string {
  switch (outcome.kind) {
    case 'environment_pending':
      return (
        '環境構築タスクは完了済みですが、プロジェクトにプレビュー設定（rapitas.runtime.json）が登録されていません。' +
        'この状態では機能タスクが永久に起票されません。設定を含むブランチが未マージの可能性があります。'
      );
    case 'throttled':
      return `未着手タスクが上限（${outcome.unstarted ?? '?'}/${outcome.cap ?? '?'}）に達しているため、${outcome.pending ?? '?'}件の機能タスクを起票できていません。`;
    case 'spec_incomplete':
      return (
        `要件定義書に ${outcome.blocking ?? '?'} 件の不備が残っているため、機能タスクを起票していません。` +
        `修正タスク（${SPEC_GATE_TASK_PREFIX}）は起票済みです。これが完了するまでこのテーマの実装は進みません。`
      );
    default:
      return '';
  }
}

/** Notification title per stalling kind; also the dedupe key with the link. */
const TITLES: Partial<Record<IntakeOutcomeKind, string>> = {
  environment_pending: '要件定義からの起票: プレビュー設定が未登録で起票が止まっています',
  throttled: '要件定義からの起票: 未着手の上限で起票を保留しています',
  spec_incomplete: '要件定義からの起票: 要件定義の不備で起票を止めています',
};

/**
 * Report an outcome that means nothing can happen, once per theme per window.
 *
 * Always emits the cycle event (cheap, structured, and what makes the state
 * findable afterwards); the notification is the part that must not repeat.
 *
 * @param outcome - The classified outcome. / 判定結果
 * @param nowMs - Injectable clock. / 現在時刻
 * @returns Whether anything was reported. / 報告したか
 */
export async function reportIntakeOutcome(
  outcome: IntakeOutcome,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!isSilentStall(outcome)) return false;
  const message = describeIntakeOutcome(outcome);
  log.warn({ ...outcome }, `[intake] nothing can be filed for this theme: ${outcome.kind}`);
  logCycleEvent('intake.stalled', {
    theme: outcome.themeId,
    ok: false,
    cause: outcome.kind,
    msg: message,
  });
  const title = TITLES[outcome.kind];
  if (!title) return false;
  await notifyOncePerWindow({
    title,
    message: `テーマ #${outcome.themeId}: ${message}`,
    link: `/themes/${outcome.themeId}`,
    metadata: { ...outcome, reason: `intake_${outcome.kind}` },
    nowMs,
  });
  return true;
}
