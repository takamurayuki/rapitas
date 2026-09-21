/**
 * pr-risk-gate
 *
 * Staged PR-risk evaluation for the pre-merge gate: off → nothing; display →
 * score + SHAP comment; hold/auto → additionally exclude a merge-mode PR whose
 * score ≥ threshold from auto-merge. Fail-open: the score is advisory, so any
 * error (gh, DB, missing generated delegates) logs a warning and never holds.
 */
import { createLogger } from '../../../config/logger';
import { runGhCommand } from '../../github/gh-client';
import { fetchPrSnapshot, type GhRunner } from './pr-risk-features';
import { parseModel, predict } from './pr-risk-model';
import { buildRiskComment, upsertRiskComment } from './pr-risk-comment';
import {
  createScore,
  defaultDb,
  ensureOutcomeTracked,
  findScore,
  markCommentPosted,
  readConfig,
  type PrRiskDb,
} from './pr-risk-store';
import type { Contribution, PrRiskStage } from './pr-risk-types';

export interface PrRiskGateDeps {
  db: PrRiskDb;
  runGh: GhRunner;
  now: () => Date;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
}

export interface PrRiskGateResult {
  hold: boolean;
  detail?: string;
}

const defaultDeps = (): PrRiskGateDeps => ({
  db: defaultDb,
  runGh: (args, cwd) => runGhCommand(args, cwd, { skipLog: true }),
  now: () => new Date(),
  log: createLogger('self-improvement:pr-risk-gate'),
});

const HOLDING_STAGES: readonly PrRiskStage[] = ['hold', 'auto'];

function holdDetail(score: number, threshold: number, contributions: Contribution[]): string {
  const top = contributions
    .slice(0, 3)
    .map((c) => `${c.feature} ${c.phi >= 0 ? '+' : ''}${c.phi.toFixed(3)}`)
    .join(', ');
  return `risk ${(score * 100).toFixed(1)}% ≥ threshold ${(threshold * 100).toFixed(1)}% (主因: ${top})`;
}

/**
 * Evaluate a PR's merge-failure risk according to the configured stage.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param mode - 'merge' (auto-merge) or 'pr' (PR only — never held) / 実行モード
 * @param link - Linked task id (may be unknown) and whether an agent authored the PR / PR の出自
 * @param deps - Injectable side effects / 依存注入
 * @returns hold=true only when the PR must be excluded from auto-merge / 保留判定
 */
export async function evaluatePrRisk(
  cwd: string,
  prNumber: number,
  mode: 'merge' | 'pr',
  // NOTE: An object rather than a bare taskId (plan §変更予定ファイル #10): the
  // pre-merge gate knows every candidate is an agent PR but is not given its
  // task id (the watcher call site is intentionally unchanged).
  link: { taskId: number | null; agentAuthored: boolean },
  deps: PrRiskGateDeps = defaultDeps(),
): Promise<PrRiskGateResult> {
  try {
    const config = await readConfig(deps.db);
    if (config.stage === 'off') return { hold: false };

    const snap = await fetchPrSnapshot(
      cwd,
      prNumber,
      { hasLinkedTask: link.agentAuthored },
      deps.runGh,
    );
    let row = await findScore(deps.db, snap.repo, prNumber, snap.headSha);
    const wouldHold = (score: number) =>
      mode === 'merge' && HOLDING_STAGES.includes(config.stage) && score >= config.threshold;

    if (!row) {
      const prediction = predict(parseModel(config.modelJson), snap.features);
      const held = wouldHold(prediction.score);
      row = await createScore(deps.db, {
        repo: snap.repo,
        prNumber,
        headSha: snap.headSha,
        taskId: link.taskId,
        score: prediction.score,
        baseLogit: prediction.baseLogit,
        featuresJson: JSON.stringify(snap.features),
        contributionsJson: JSON.stringify(prediction.contributions),
        thresholdUsed: config.threshold,
        stage: config.stage,
        modelVersion: config.modelVersion,
        held,
        commentPostedAt: null,
      });
      await ensureOutcomeTracked(deps.db, snap.repo, prNumber);
      try {
        const body = buildRiskComment({
          prediction,
          threshold: config.threshold,
          stage: config.stage,
          held,
        });
        await upsertRiskComment(cwd, prNumber, body, deps.runGh);
        await markCommentPosted(deps.db, row.id, deps.now());
      } catch (err) {
        deps.log.warn({ err, prNumber }, '[pr-risk] comment upsert failed — score kept');
      }
    }

    // Decided against the CURRENT config so a threshold/stage change applies
    // to an already-scored head SHA without rescoring.
    if (!wouldHold(row.score)) return { hold: false };
    const contributions = JSON.parse(row.contributionsJson) as Contribution[];
    return { hold: true, detail: holdDetail(row.score, config.threshold, contributions) };
  } catch (err) {
    deps.log.warn({ err, prNumber }, '[pr-risk] evaluation failed — failing open (no hold)');
    return { hold: false };
  }
}
