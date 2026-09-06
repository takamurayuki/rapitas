/**
 * supervisor-incident-inspect
 *
 * Wiring for the four supervisor-derived incident signatures: gathers the
 * evidence, runs the pure detectors, builds the evidence lines the concern
 * body must carry (paths, gap seconds, matched lines), and files each finding
 * through the caller-injected `file` function (DI avoids a circular import
 * with self-incident-watcher). Detection only — repairs stay with the
 * concern → task → workflow pipeline.
 */
import type { ConcernSeverity } from '../memory/concern-backlog-service';
import type { GatheredTaskState } from './self-incident-evidence';
import { gatherSupervisorEvidence } from './supervisor-incident-evidence';
import {
  detectCwdMismatch,
  detectFalseFailure,
  detectFalseForceStop,
  detectThemeMisplacement,
  FALSE_FAILURE_WINDOW_MS,
  FORCESTOP_MIN_GAP_MS,
  MISPLACEMENT_MIN_ITEMS,
  MISPLACEMENT_RATIO,
} from './supervisor-incident-detectors';

/** The candidate-task shape the watcher already selects (structural match). */
export interface SupervisorTaskRef {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  updatedAt: Date;
  themeId: number | null;
  /** Mirrors CandidateTask.workflowDisabled (#860) — unused here, kept for structural match. */
  workflowDisabled: boolean;
}

/** The watcher's fileFinding, injected to avoid a circular import. */
export type SupervisorFileFn = (args: {
  signature: string;
  task: SupervisorTaskRef;
  state: GatheredTaskState;
  title: string;
  explanation: string;
  thresholdDescription: string;
  severity: ConcernSeverity;
  nowMs: number;
  evidenceLines?: string[];
}) => Promise<boolean>;

/**
 * Kill switch for the whole supervisor-signature pass (extra DB load escape
 * hatch). Any value except '' / '0' / 'false' disables it.
 */
function isSupervisorIncidentDisabled(): boolean {
  const value = (process.env.RAPITAS_SUPERVISOR_INCIDENT_DISABLED ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

/**
 * Runs the four supervisor detectors over one task and files a concern per
 * finding, each carrying a `## 検出証拠` section with the same evidence a
 * human supervisor read (paths, gap seconds, matched lines).
 *
 * @param args.task - Candidate task row. / 対象タスク
 * @param args.state - Base evidence already gathered by the watcher. / 収集済み基本証拠
 * @param args.nowMs - Current time (ms). / 現在時刻
 * @param args.file - The watcher's concern-filing function. / 起票関数(DI)
 * @returns Number of concerns filed. / 起票件数
 */
export async function inspectSupervisorSignatures(args: {
  task: SupervisorTaskRef;
  state: GatheredTaskState;
  nowMs: number;
  file: SupervisorFileFn;
}): Promise<number> {
  if (isSupervisorIncidentDisabled()) return 0;
  const { task, state, nowMs, file } = args;
  const ev = await gatherSupervisorEvidence(task);
  let filed = 0;

  // A: the execution worked outside the theme's repository (task 580 class).
  const mismatch = detectCwdMismatch({
    executionCwd: ev.executionCwd,
    themeWorkingDirectory: ev.themeWorkingDirectory,
  });
  if (mismatch) {
    const ok = await file({
      signature: 'supervisor-cwd-mismatch',
      task,
      state,
      title: `[自己検出] 調査先リポジトリ不一致: #${task.id}「${task.title}」`,
      explanation:
        '最新実行の作業ディレクトリがテーマの作業ディレクトリ(または配下の.worktrees)と一致しません。' +
        '別リポジトリを調査・実装したまま結論を出した疑いがあります(task 580と同型)。',
      thresholdDescription:
        '構造判定（実行cwdがテーマ作業ディレクトリとも <themeDir>/.worktrees/ 配下とも不一致）',
      severity: 'high',
      nowMs,
      evidenceLines: [
        `実行cwd: ${mismatch.cwd}`,
        `テーマ作業ディレクトリ: ${mismatch.themeDir}`,
        ...(ev.executionCwdLine ? [`該当行: ${ev.executionCwdLine}`] : []),
      ],
    });
    if (ok) filed++;
  }

  // B: a success artifact landed right after a terminal failure mark (task 580 / PR #7 class).
  const falseFailure = detectFalseFailure({
    failureMarkedAtMs: ev.failureMarkedAtMs,
    successArtifactAtMs: ev.successArtifactAtMs,
  });
  if (falseFailure && ev.failureMarkedAtMs !== null && ev.successArtifactAtMs !== null) {
    const gapSec = Math.round(falseFailure.gapMs / 1000);
    const ok = await file({
      signature: 'supervisor-false-failure',
      task,
      state,
      title: '[自己検出] 誤った失敗判定: 失敗マーク直後に成功アーティファクトが出現する',
      explanation:
        `タスクが終端失敗とマークされた${gapSec}秒後に成功アーティファクト(PR/コミット)が出現しました。` +
        '完了ゲートが実際には成功した実行を「失敗」と誤記録した疑いがあります(task 580 / PR #7と同型)。',
      thresholdDescription: `失敗マーク後 ${Math.round(FALSE_FAILURE_WINDOW_MS / 60_000)}分以内の成功アーティファクト出現`,
      severity: 'medium',
      nowMs,
      evidenceLines: [
        `終端失敗マーク: ${new Date(ev.failureMarkedAtMs).toISOString()}` +
          (ev.failureMarkSource ? ` (source: ${ev.failureMarkSource})` : ''),
        `成功アーティファクト: ${new Date(ev.successArtifactAtMs).toISOString()}` +
          (ev.successArtifactRef ? ` — ${ev.successArtifactRef}` : ''),
        `時刻差: ${gapSec}秒`,
      ],
    });
    if (ok) filed++;
  }

  // C: the hang backstop killed a task that had just made progress (task 585 class).
  const falseStop = detectFalseForceStop({
    backstopAtMs: ev.backstopAtMs,
    lastProgressAtMs: ev.lastProgressAtMs,
  });
  if (falseStop && ev.backstopAtMs !== null && ev.lastProgressAtMs !== null) {
    const gapSec = Math.round(falseStop.gapMs / 1000);
    const ok = await file({
      signature: 'supervisor-false-forcestop',
      task,
      state,
      title: `[自己検出] 誤った強制停止: #${task.id}「${task.title}」— 進捗の${gapSec}秒後にバックストップ`,
      explanation:
        `直近の進捗(phase_completed遷移)の${gapSec}秒後にハングバックストップが強制停止しています。` +
        '進行中だったタスクの誤検知停止の疑いがあります(task 585と同型)。',
      thresholdDescription: `直近進捗からバックストップまでの時間差が ${Math.round(FORCESTOP_MIN_GAP_MS / 1000)}秒未満`,
      severity: 'medium',
      nowMs,
      evidenceLines: [
        `直近の進捗: ${new Date(ev.lastProgressAtMs).toISOString()}` +
          (ev.lastProgressCause ? ` (cause: ${ev.lastProgressCause})` : ''),
        `強制停止通知: ${new Date(ev.backstopAtMs).toISOString()} (auto_run_hang_backstop)`,
        `時刻差: ${gapSec}秒`,
      ],
    });
    if (ok) filed++;
  }

  // D: the verify checklist is dominated by "no target" verdicts (task 587 class).
  const misplacement = detectThemeMisplacement({
    checklistTotal: ev.verifyChecklist.total,
    noTargetCount: ev.verifyChecklist.noTargetCount,
  });
  if (misplacement) {
    const pct = Math.round(misplacement.ratio * 100);
    const ok = await file({
      signature: 'supervisor-theme-misplacement',
      task,
      state,
      title: `[自己検出] テーマ誤配置の疑い: #${task.id}「${task.title}」— verifyの${pct}%が対象なし`,
      explanation:
        `verifyチェックリスト${misplacement.total}項目中${misplacement.noTargetCount}項目(${pct}%)が` +
        '「対象コードなし/該当なし」系の判定で埋まっています。タスクが参照するコードがこのテーマの' +
        'リポジトリに存在しない=誤ったテーマへの起票の疑いがあります(task 587と同型)。',
      thresholdDescription:
        `チェックリスト${MISPLACEMENT_MIN_ITEMS}項目以上かつ「対象なし」比率` +
        `${Math.round(MISPLACEMENT_RATIO * 100)}%以上`,
      severity: 'high',
      nowMs,
      evidenceLines: [
        `verifyチェックリスト: ${misplacement.noTargetCount}/${misplacement.total} 項目が「対象なし」系 (${pct}%)`,
        ...ev.verifyChecklist.samples.map((s) => `該当行: ${s}`),
      ],
    });
    if (ok) filed++;
  }

  return filed;
}
