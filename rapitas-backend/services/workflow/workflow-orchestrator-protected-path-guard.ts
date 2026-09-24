/**
 * Workflow Orchestrator — Protected-Path Mode Guard
 *
 * Runs right before the implementer of a LIGHTWEIGHT task. When research.md
 * declares a change under a protected gate/CI/hook path, the task cannot pass
 * the anti-tamper tripwire without an approved plan.md — which lightweight mode
 * never produces. Escalate to standard mode here (planner lists the file,
 * approval, then implement) instead of letting the verifier bounce it.
 *
 * Tasks 1044 (2026-09-23, backlog-promoted) and 1055 (2026-09-24, human-filed)
 * both lost a full verify round to exactly this; the filing-time pin in
 * backlog-promoter-execute.ts only covers promoted concerns, this covers every
 * origin because it reads what the researcher actually intends to change.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { needsPlanForProtectedPath } from '../memory/concern-task-spec';
import { readWorkflowFile } from './workflow-file-utils';
import type { WorkflowAdvanceResult } from './workflow-agent-executor';
import { recordTransition } from './transition-recorder';
import type { RoleTransition, WorkflowMode, WorkflowStatus } from './workflow-types';
import { scheduleWorkflowRedispatch } from './workflow-redispatch';

const log = createLogger('workflow-orchestrator');

/** Transition cause recorded when this guard escalates a task's mode. */
export const PROTECTED_PATH_ESCALATION_CAUSE = 'protected_path_mode_escalated';

/**
 * The part of research.md that names the files to change. The research
 * template writes a 「変更予定箇所」 table; when present, only that section is
 * scanned so a protected path mentioned merely as context (e.g. "the gate in
 * services/agents/verification/ rejects this") does not force a plan phase.
 * Without the section the whole document is scanned.
 *
 * @param researchMd - research.md content. / research.md 本文
 * @returns Text to scan for protected paths. / 走査対象テキスト
 */
export function plannedChangeSection(researchMd: string): string {
  const m = researchMd.match(/変更予定箇所|Files to change|変更対象ファイル/);
  if (!m || m.index === undefined) return researchMd;
  const rest = researchMd.slice(m.index);
  const next = rest.slice(m[0].length).search(/\n#{2,3} /);
  return next >= 0 ? rest.slice(0, m[0].length + next) : rest;
}

/**
 * Escalate a lightweight task to standard mode when research.md plans a change
 * under a protected path. Returns `{ done: false }` when the guard does not
 * apply (other roles / plan modes / no protected path).
 *
 * @param taskId - The task about to advance. / 対象タスクID
 * @param transition - Transition about to execute. / 実行予定の遷移
 * @param workflowMode - Effective workflow mode. / 有効なワークフローモード
 * @param language - Language for the re-dispatch. / 再ディスパッチの言語
 * @returns `{ done: true, result }` when escalated, else `{ done: false }`. / 昇格時は早期終了結果
 */
export async function guardProtectedPathMode(
  taskId: number,
  transition: RoleTransition,
  workflowMode: WorkflowMode,
  language: 'ja' | 'en',
) {
  if (transition.role !== 'implementer' || workflowMode !== 'lightweight') {
    return { done: false as const };
  }
  const researchMd = await readWorkflowFile(taskId, 'research').catch(() => null);
  if (!researchMd || !needsPlanForProtectedPath(plannedChangeSection(researchMd))) {
    return { done: false as const };
  }

  log.warn(
    { taskId },
    '[WorkflowOrchestrator] research.md plans a protected-path change in lightweight mode — escalating to standard so plan.md can list it',
  );
  await prisma.task.update({
    where: { id: taskId },
    data: { workflowMode: 'standard', workflowModeOverride: true, updatedAt: new Date() },
  });
  await recordTransition({
    taskId,
    fromStatus: 'research_done',
    toStatus: 'research_done',
    actor: 'system',
    cause: PROTECTED_PATH_ESCALATION_CAUSE,
    phase: 'plan',
    metadata: {
      reason:
        'research.md declares a change under a protected gate/CI/hook path; lightweight mode has no plan.md to list it, so the tamper tripwire would fail — escalated to standard mode',
    },
  }).catch(() => {});
  // The mode change alone advances nothing: re-dispatch so the planner runs
  // now (same reasoning as the plan-invalid rollback in the sibling guard).
  scheduleWorkflowRedispatch(taskId, PROTECTED_PATH_ESCALATION_CAUSE, language);
  const result: WorkflowAdvanceResult = {
    success: true,
    role: transition.role,
    status: 'research_done' as WorkflowStatus,
    output:
      '保護パス（検証ゲート/CI/フック）への変更が調査で計画されているため、plan.md で対象ファイルを明記できる標準モードへ昇格し、計画フェーズへ進めます',
  };
  return { done: true as const, result };
}
