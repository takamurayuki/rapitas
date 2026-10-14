/**
 * incident-signature-detectors.repeat-loop-t1202.test
 *
 * Regression pin for the self-detected incident on task 1202: three
 * `phase_completed:planner` firings on #1168, each re-authorized by a
 * requirement replan (system) or a plan revision request (actor=user), were
 * reported as a loop. Replays #1168's real 07:33-08:02 timeline. Pure inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

const DETECTED_AT_MS = Date.parse('2026-10-09T08:02:38.721Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
});

const TASK_1168_WINDOW: RepeatLoopTransition[] = [
  t('2026-10-09T07:33:21.086Z', 'phase_completed:researcher', 'researcher'),
  t('2026-10-09T07:34:11.589Z', 'phase_completed:planner', 'planner'),
  t('2026-10-09T07:34:11.603Z', 'auto_approve_plan', 'system'),
  t('2026-10-09T07:35:20.621Z', 'phase_completed:implementer', 'implementer'),
  t('2026-10-09T07:36:27.640Z', 'requirement_evidence_replan', 'system'),
  t('2026-10-09T07:37:42.961Z', 'phase_completed:planner', 'planner'),
  t('2026-10-09T07:38:29.846Z', 'file_saved:question', 'system'),
  t('2026-10-09T07:44:45.805Z', 'plan_revision_requested', 'user'),
  t('2026-10-09T08:02:27.528Z', 'phase_completed:planner', 'planner'),
];

describe('detectRepeatLoop — task 1202 (replan-authorized planner re-runs)', () => {
  it('does not report planner re-runs that each follow a replan/revision as a loop', () => {
    expect(detectRepeatLoop({ transitions: TASK_1168_WINDOW, nowMs: DETECTED_AT_MS })).toBeNull();
  });

  it('still reports planner churn with no replan authorizing it', () => {
    const churn = [
      t('2026-10-09T07:34:11.589Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T07:37:42.961Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T08:02:27.528Z', 'phase_completed:planner', 'planner'),
    ];
    expect(detectRepeatLoop({ transitions: churn, nowMs: DETECTED_AT_MS })).toMatchObject({
      cause: 'phase_completed:planner',
      count: 3,
    });
  });

  it('still reports firings beyond what the replans authorize', () => {
    const extra = [
      ...TASK_1168_WINDOW,
      t('2026-10-09T08:00:00.000Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T08:01:00.000Z', 'phase_completed:planner', 'planner'),
    ];
    expect(detectRepeatLoop({ transitions: extra, nowMs: DETECTED_AT_MS })).toMatchObject({
      cause: 'phase_completed:planner',
    });
  });

  it('does not let a user revision forgive firings that precede it', () => {
    const early = [
      t('2026-10-09T07:30:00.000Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T07:31:00.000Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T07:32:00.000Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T07:33:00.000Z', 'phase_completed:planner', 'planner'),
      t('2026-10-09T07:44:45.805Z', 'plan_revision_requested', 'user'),
    ];
    expect(detectRepeatLoop({ transitions: early, nowMs: DETECTED_AT_MS })).toMatchObject({
      cause: 'phase_completed:planner',
      count: 3,
    });
  });
});
