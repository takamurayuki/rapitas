/**
 * phase-segmentation — every send-back starts a new round
 *
 * 2026-11-25: 「差し戻しがあった場合は回数ごとのタブで実行ログの切り替えが
 * できていたのに、タブの切り替えが消えている」. Rounds were split only on
 * verify_repair / ci_repair; the send-backs added since (evidence re-plan, plan
 * and research critics, plan revision after an answer, retries) folded every
 * round into one, so task 1547 showed a single round per phase.
 */
import { describe, it, expect } from 'bun:test';
import {
  segmentPhases,
  type RawPhaseExecution,
  type RawPhaseTransition,
} from './phase-segmentation';

const at = (m: number) => new Date(Date.UTC(2026, 10, 25, 12, m)).toISOString();

function run(
  id: number,
  phaseType: RawPhaseExecution['phaseType'],
  start: number,
): RawPhaseExecution {
  return {
    id,
    phaseType,
    status: 'completed',
    startedAt: at(start),
    completedAt: at(start + 1),
    createdAt: at(start),
    logLineCount: 1,
  };
}

function moved(cause: string, from: string | null, to: string, m: number): RawPhaseTransition {
  return { cause, fromStatus: from, toStatus: to, createdAt: at(m) };
}

const rounds = (r: ReturnType<typeof segmentPhases>, phase: string) =>
  r.phases.find((p) => p.phaseType === phase)?.iterations.map((i) => i.executionIds) ?? [];

describe('a send-back that is not a repair', () => {
  it('splits both plan and implement after an evidence re-plan', () => {
    const executions = [
      run(1, 'plan', 0),
      run(2, 'implement', 5),
      run(3, 'plan', 20),
      run(4, 'implement', 25),
    ];
    const transitions = [moved('requirement_evidence_replan', 'in_progress', 'research_done', 15)];
    const r = segmentPhases(executions, transitions, true);
    expect(rounds(r, 'plan')).toEqual([[1], [3]]);
    expect(rounds(r, 'implement')).toEqual([[2], [4]]);
  });

  // One phase, one send-back, two runs of that phase: each must open round 2.
  it.each([
    ['plan critic', 'plan', moved('plan_critic_failed', 'plan_created', 'research_done', 3)],
    ['research critic', 'research', moved('research_critic_failed', 'research_done', 'draft', 3)],
    [
      'plan revision after an answer',
      'plan',
      moved('plan_revision_requested', 'awaiting_question', 'research_done', 3),
    ],
  ] as const)('opens a second round after a %s', (_label, phase, sendBack) => {
    const executions = [run(1, phase, 0), run(2, phase, 5)];
    expect(rounds(segmentPhases(executions, [sendBack], true), phase)).toEqual([[1], [2]]);
  });

  it('leaves earlier phases alone: a verify_repair does not split research or plan', () => {
    const executions = [
      run(1, 'plan', 0),
      run(2, 'implement', 5),
      run(3, 'verify', 10),
      run(4, 'implement', 20),
    ];
    const transitions = [moved('verify_repair', 'in_progress', 'plan_approved', 15)];
    const r = segmentPhases(executions, transitions, true);
    expect(rounds(r, 'plan')).toEqual([[1]]);
    expect(rounds(r, 'implement')).toEqual([[2], [4]]);
  });

  it('does not split on a forward move or a same-status note', () => {
    const executions = [run(1, 'plan', 0), run(2, 'plan', 5)];
    const transitions = [
      moved('phase_completed:planner', 'research_done', 'plan_created', 2),
      moved('plan_critic_incomplete', 'plan_created', 'plan_created', 3),
    ];
    expect(rounds(segmentPhases(executions, transitions, true), 'plan')).toEqual([[1, 2]]);
  });
});
