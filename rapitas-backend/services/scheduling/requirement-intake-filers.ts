/**
 * requirement-intake-filers
 *
 * The single-task filings the requirement intake performs besides the
 * per-feature ones: the environment setup a documents-only project needs first,
 * the requirements gap that must be closed before any feature is filed, and the
 * documentation follow-up when the document has fallen behind the work.
 *
 * Split out of requirement-intake-job.ts to keep that file under the 300-line
 * limit. Not responsible for scanning themes, reading documents, or deciding
 * the per-feature batch — the job owns all three and injects its own deps.
 */

import { createLogger } from '../../config/logger';
import { detectSpecDrift, toDriftTaskPayload, DRIFT_TASK_PREFIX } from '../organization/spec-drift';
import {
  toBootstrapTaskPayload,
  BOOTSTRAP_TASK_PREFIX,
} from '../organization/project-bootstrap-task';
import { toSpecGateTaskPayload, SPEC_GATE_TASK_PREFIX } from '../organization/spec-gate-task';
import { toScreenTaskPayload, screenTaskTitle } from '../organization/screen-task-payload';
import type { SpecFinding } from '../organization/spec-consistency';
import type { ScreenTaskSpec } from '../organization/screen-task-plan';
import type { RequirementIntakeDeps } from './requirement-intake-types';

const log = createLogger('scheduling:requirement-intake');

/**
 * Whether an environment-setup task is already filed for this theme.
 *
 * Exported so the caller can classify the resulting zero-filing outcome
 * (requirement-intake-outcome.ts) against the SAME prefix rule
 * {@link fileBootstrapTask} applies, rather than a second copy of it.
 *
 * @param existing - Task titles in the theme. / 既存タスク名
 * @returns Whether a setup task exists. / 環境構築タスクが既にあるか
 */
export function hasBootstrapTaskFiled(existing: readonly string[]): boolean {
  return existing.some((t) => t.trimStart().startsWith(BOOTSTRAP_TASK_PREFIX));
}

/** Project name for the task title: the working directory's own folder name. */
export function projectNameOf(workingDirectory: string): string {
  const parts = workingDirectory.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || workingDirectory;
}

/**
 * File the environment-setup task, unless one is already filed.
 *
 * Idempotent by title PREFIX rather than exact title: the project name could be
 * reworded, and a second setup task would compete for the same auto-run slot.
 *
 * @param themeId - Theme being scanned / 対象テーマ
 * @param workingDirectory - Project root / プロジェクトルート
 * @param defaultBranch - Branch the documents are authoritative on / 正となるブランチ
 * @param existing - Task titles in the theme / 既存タスク名
 * @param deps - Injected collaborators / 注入された依存
 * @param state - What is already in place, so the task says what is missing / 既存の状態
 * @returns 1 when a task was filed, else 0 / 起票したら 1
 */
export async function fileBootstrapTask(
  themeId: number,
  workingDirectory: string,
  defaultBranch: string | null | undefined,
  existing: readonly string[],
  deps: RequirementIntakeDeps,
  state: { hasManifest?: boolean } = {},
): Promise<number> {
  if (hasBootstrapTaskFiled(existing)) {
    // WARN, not INFO: this hold is indistinguishable from normal throttling in
    // the logs, and it has no exit of its own. Measured 2026-10-12 — #1212
    // completed, produced the config and pushed it on a task branch that was
    // never merged, so the project read as "still needs setting up" while this
    // check suppressed re-filing. Feature tasks were held indefinitely with no
    // error anywhere. Naming what is missing is what makes that state findable.
    log.warn(
      { themeId, workingDirectory, missing: 'preview config on the authoritative branch' },
      'Environment setup is already filed but the project still lacks preview config — ' +
        'feature tasks stay held. If the setup task is already done, its branch is probably unmerged',
    );
    return 0;
  }
  const design = await deps.readDesign(workingDirectory, defaultBranch).catch(() => null);
  const payload = toBootstrapTaskPayload({
    themeId,
    projectName: projectNameOf(workingDirectory),
    design,
    hasManifest: state.hasManifest,
  });
  try {
    const task = await deps.createTask(payload);
    if (!task) return 0;
    log.info(
      { themeId, workingDirectory, hasManifest: state.hasManifest === true },
      'Filed the environment-setup task; feature tasks wait for it',
    );
    return 1;
  } catch (err) {
    log.warn({ err, themeId }, 'Failed to file the environment-setup task (non-fatal)');
    return 0;
  }
}

/**
 * File the requirements gap that blocks every feature in this theme.
 *
 * One open gate task at a time: the job runs daily and the work is the same on
 * every run until an author closes it. Returning 0 for "already filed" is NOT
 * permission to file features — the caller stops either way, because the
 * document is still the one the checker rejected.
 *
 * @param themeId - Theme being scanned / 対象テーマ
 * @param findings - Result of checkSpecConsistency / 検査結果
 * @param existing - Task titles in the theme / 既存タスク名
 * @param deps - Injected collaborators / 注入された依存
 * @returns 1 when a task was filed, else 0 / 起票したら 1
 */
export async function fileSpecGateTask(
  themeId: number,
  findings: readonly SpecFinding[],
  existing: readonly string[],
  deps: RequirementIntakeDeps,
): Promise<number> {
  if (existing.some((t) => t.trimStart().startsWith(SPEC_GATE_TASK_PREFIX))) return 0;

  const payload = toSpecGateTaskPayload(findings, { themeId });
  if (!payload) return 0;

  try {
    const task = await deps.createTask(payload);
    if (!task) return 0;
    log.info(
      { themeId, blocking: findings.filter((f) => f.severity === 'error').length },
      'Filed requirements gap task; feature filing is held until it is closed',
    );
    return 1;
  } catch (err) {
    log.warn({ err, themeId }, 'Failed to file requirements gap task (non-fatal)');
    return 0;
  }
}

/**
 * Screens declared in the document that have no task yet.
 *
 * Exported so the job can decide whether to hold the features back using the
 * SAME title rule this module files with, rather than a second copy of it.
 *
 * @param screens - Parsed 画面一覧 / 解析済みの画面一覧
 * @param existing - Task titles in the theme / 既存タスク名
 * @returns Screens still to file, in document order / 未起票の画面
 */
export function unfiledScreens(
  screens: readonly ScreenTaskSpec[],
  existing: readonly string[],
): ScreenTaskSpec[] {
  const titles = new Set(existing.map((t) => t.trim()));
  return screens.filter((s) => !titles.has(screenTaskTitle(s.name)));
}

/**
 * File one task per screen, up to `limit`.
 *
 * Screens are filed BEFORE any feature, because a feature whose 画面導線 names
 * a screen that does not exist has to build that screen as a side effect —
 * and every feature's design legitimately puts the UI outside its own scope
 * (TempoRaid's design.md:159 lists 「webのログイン画面」 under F-11's 範囲外).
 * That is how twelve finished features shipped two .tsx files.
 *
 * @param themeId - Theme being scanned / 対象テーマ
 * @param screens - Screens still to file / 未起票の画面
 * @param outOfScope - Document-level non-goals / スコープ外の項目
 * @param limit - How many may be filed this run / 今回起票してよい件数
 * @param deps - Injected collaborators / 注入された依存
 * @returns How many were filed / 起票した件数
 */
export async function fileScreenTasks(
  themeId: number,
  screens: readonly ScreenTaskSpec[],
  outOfScope: readonly string[],
  limit: number,
  deps: RequirementIntakeDeps,
): Promise<number> {
  let filed = 0;
  for (const spec of screens.slice(0, Math.max(0, limit))) {
    try {
      const task = await deps.createTask(toScreenTaskPayload(spec, { themeId, outOfScope }));
      if (!task) continue;
      filed += 1;
      log.info({ themeId, screen: spec.name }, 'Filed screen task from requirements.md');
    } catch (err) {
      log.warn({ err, themeId, screen: spec.name }, 'Failed to file screen task (non-fatal)');
    }
  }
  return filed;
}

/**
 * File the documentation follow-up when the document and the work disagree.
 *
 * Must run AFTER the per-feature filing so this run's new tasks count as filed
 * — otherwise every run would report the features it had just created as
 * missing from the work.
 *
 * @param themeId - Theme being scanned / 対象テーマ
 * @param markdown - requirements.md content / requirements.md の内容
 * @param existing - Task titles BEFORE this run's filing / 今回起票前のタスク名
 * @param deps - Injected collaborators / 注入された依存
 * @returns 1 when a task was filed, else 0 / 起票したら 1
 */
export async function fileDriftTask(
  themeId: number,
  markdown: string,
  existing: readonly string[],
  deps: RequirementIntakeDeps,
): Promise<number> {
  // One open follow-up at a time: the job runs daily and the work is the same
  // every run until someone does it.
  if (existing.some((t) => t.trimStart().startsWith(DRIFT_TASK_PREFIX))) return 0;

  const findings = detectSpecDrift({ requirements: markdown, existingTitles: existing });
  const payload = toDriftTaskPayload(findings, { themeId });
  if (!payload) return 0;

  try {
    const task = await deps.createTask(payload);
    if (!task) return 0;
    log.info({ themeId, findings: findings.length }, 'Filed documentation drift task');
    return 1;
  } catch (err) {
    log.warn({ err, themeId }, 'Failed to file drift task (non-fatal)');
    return 0;
  }
}
