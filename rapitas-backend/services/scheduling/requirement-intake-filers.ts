/**
 * requirement-intake-filers
 *
 * The two single-task filings the requirement intake performs besides the
 * per-feature ones: the environment setup a documents-only project needs first,
 * and the documentation follow-up when the document has fallen behind the work.
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
