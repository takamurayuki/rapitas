/**
 * self-incident-file-finding
 *
 * Files one detected incident as a dedup-keyed concern for the self-incident
 * watcher. Split out of self-incident-watcher.ts to keep it under the
 * per-file line limit. NOT responsible for detection or candidate selection.
 */
import { createLogger } from '../../config/logger';
import { submitConcern, type ConcernSeverity } from '../memory/concern-backlog-service';
import { resolveSelfDevelopmentThemeId } from './self-development-theme';
import { formatIncidentDetail } from './self-incident-evidence';
import type { GatheredTaskState } from './self-incident-evidence';

const log = createLogger('self-incident-watcher');

/** Truncation limit for concern titles (long titles hurt task conversion). */
const TITLE_MAX_CHARS = 120;

/** A candidate task row as selected by the watch query. */
export interface CandidateTask {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  updatedAt: Date;
  /** Theme the task belongs to (null = unthemed) — feeds the Pattern B auto-run gate. */
  themeId: number | null;
  /** Task-level workflow-disabled flag — feeds the stagnation isWorkflowManaged gate (#860). */
  workflowDisabled: boolean;
}

/** Formats + files one finding as a dedup-keyed concern. Never throws. */
export async function fileFinding(args: {
  signature: string;
  task: CandidateTask;
  state: GatheredTaskState;
  title: string;
  explanation: string;
  thresholdDescription: string;
  severity: ConcernSeverity;
  nowMs: number;
  /** Signature-specific evidence bullets, rendered as `## 検出証拠`. */
  evidenceLines?: string[];
}): Promise<boolean> {
  try {
    // File against the theme that develops RAPITAS: these findings are about
    // rapitas' own workflow tables and code. Inheriting the origin task's theme
    // sent a state-inconsistency concern into the converter project, where the
    // promoted task could only report "対象コードなし" and exhaust its repair
    // budget (task 587). Falls back to the origin theme when unresolvable.
    const selfThemeId = await resolveSelfDevelopmentThemeId();
    await submitConcern({
      ...(selfThemeId != null ? { themeId: selfThemeId } : {}),
      title: args.title.slice(0, TITLE_MAX_CHARS),
      detail: formatIncidentDetail({
        state: args.state,
        explanation: args.explanation,
        thresholdDescription: args.thresholdDescription,
        detectedAtIso: new Date(args.nowMs).toISOString(),
        ...(args.evidenceLines ? { evidenceLines: args.evidenceLines } : {}),
      }),
      type: 'bug',
      severity: args.severity,
      originTaskId: args.task.id,
      source: 'self_incident_watch',
      // Per SIGNATURE, not per task. 「停滞: #646 が33分間停滞」 and
      // 「停滞: #624 が31分間停滞」 are one defect seen twice, and the fix is not
      // per task — keying on the task id turned four defect signatures into 41
      // open concerns (measured 2026-08-27), each promoting to its own task.
      // A dismissed or resolved concern no longer blocks, so a genuine
      // recurrence after triage still files again.
      dedupKey: `self-incident:${args.signature}`,
      // Aggregates same-signature refilings across tasks instead of one row
      // per detection (#801) — taskId is the instance-varying value the
      // signature itself deliberately excludes (see the dedupKey comment above).
      recurrencePolicy: {
        enabled: true,
        instanceValue: `taskId:${args.task.id}`,
        detectedAt: args.nowMs,
      },
    });
    return true;
  } catch (err) {
    log.warn(
      { err, taskId: args.task.id, signature: args.signature },
      '[self-incident] concern filing failed — continuing',
    );
    return false;
  }
}
