/**
 * acceptance-status-service tests
 *
 * `met` is the conjunction of the streak bar, sufficient knowledge-reuse evidence,
 * observation evidence and intact intervention writes; this task's own gate
 * change resets the streak; a failed snapshot write never throws.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTimelineFake } from './testing/timeline-fake';

process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'supervision-acceptance-'));

const fake = createTimelineFake(new Date('2026-09-12T00:00:00Z'));
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: { findMany: async () => [] },
    task: { findMany: async () => [] },
  },
}));

const svc = await import('./acceptance-status-service');
const { isGateMutationPath } = await import('./gate-mutation-paths');
type AcceptanceEvidence = import('./acceptance-status-service').AcceptanceEvidence;

const H = 3_600_000;
const NOW = new Date('2026-09-12T00:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

function evidence(opts: {
  streakOk: boolean;
  knowledgeOk: boolean;
  gateAt?: Date;
}): AcceptanceEvidence {
  const completions = Array.from({ length: opts.streakOk ? 10 : 3 }, (_, i) => ({
    at: ago(20 - i),
    taskId: 10 + i,
  }));
  const k = {
    schemaVersion: 1,
    evalSetVersion: 'eval-v1',
    methodVersion: 'paired-v1',
    pairedN: 30,
    missingRetainedN: 2,
    successRateWithKB: 0.7,
    successRateWithoutKB: 0.6,
    effectSize: 0.1,
    intervalOrPValue: null,
    sufficientEvidence: opts.knowledgeOk,
  };
  const gateAt = opts.gateAt ?? ago(48);
  return {
    streak: {
      now: NOW,
      horizonStart: ago(72),
      interventions: [{ at: ago(30), taskId: 1 }],
      failures: [],
      completions,
      gateMutation: { at: gateAt, observable: true },
      gaps: [],
      firstHeartbeatAt: ago(72),
      lastHeartbeatAt: ago(0.01),
      heartbeatIntervalMs: 60_000,
      heartbeatHistoryTruncated: false,
    },
    writeHealth: {
      pendingSpooled: 0,
      corruptSpoolLines: 0,
      unspooledFailure: false,
      scanFailed: false,
    },
    knowledge: { sufficientEvidence: opts.knowledgeOk, latest: k, recordedAt: ago(1) },
    gate: { at: gateAt, observable: true, commit: 'abc' },
    heartbeatCount: 4320,
    blockingTaskIds: [],
  };
}

beforeEach(() => {
  fake.rows.length = 0;
  fake.setNow(NOW);
});

describe('evaluateAcceptance conjunction', () => {
  test.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('streakOk=%p knowledgeOk=%p -> met=%p', (streakOk, knowledgeOk, met) => {
    const s = svc.evaluateAcceptance(evidence({ streakOk, knowledgeOk }));
    expect(s.met).toBe(met);
    expect(s.reasonCodes.includes('knowledge_reuse_evidence_insufficient')).toBe(!knowledgeOk);
    expect(s.reasonCodes.includes('streak_task_count_below_threshold')).toBe(!streakOk);
    expect(s.evalSetVersion).toBe('eval-v1');
  });

  test('a pending intervention write keeps it unmet even when everything else passes', () => {
    const e = evidence({ streakOk: true, knowledgeOk: true });
    e.writeHealth.pendingSpooled = 1;
    const s = svc.evaluateAcceptance(e);
    expect(s.met).toBe(false);
    expect(s.reasonCodes).toContain('intervention_write_failed');
  });
});

describe('self gate mutation (task 904 landing)', () => {
  test('the files this task changes are gate paths', () => {
    for (const p of [
      'rapitas-backend/services/supervision/acceptance-status-service.ts',
      'rapitas-backend/routes/agents/supervision/supervision-router.ts',
      'rapitas-backend/services/memory/types.ts',
      'rapitas-backend/services/workflow/completion-gate.ts',
      'rapitas-frontend/src/app/agents/supervision/page.tsx',
    ]) {
      expect(isGateMutationPath(p)).toBe(true);
    }
    expect(isGateMutationPath('rapitas-backend/services/workflow/auto-merge-watcher.ts')).toBe(
      false,
    );
  });

  test('a gate commit after an otherwise passing streak resets it to 0', () => {
    const s = svc.evaluateAcceptance(
      evidence({ streakOk: true, knowledgeOk: true, gateAt: ago(0.5) }),
    );
    expect(s.streakCount).toBe(0);
    expect(s.met).toBe(false);
    expect(s.reasonCodes).toContain('self_gate_mutation');
  });
});

describe('refreshAcceptanceSnapshot', () => {
  test('with no evidence at all it persists an unmet snapshot with no_observation_evidence', async () => {
    const s = await svc.refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now: NOW });
    expect(s?.met).toBe(false);
    expect(s?.reasonCodes).toContain('no_observation_evidence');
    expect(s?.reasonCodes).toContain('knowledge_reuse_evidence_insufficient');
    expect(fake.rows.some((r) => r.eventType === 'supervision_acceptance_snapshot')).toBe(true);
  });

  test('a failed snapshot write returns null without throwing', async () => {
    fake.failNextAppends(1, 'supervision_acceptance_snapshot');
    expect(
      await svc.refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now: NOW }),
    ).toBeNull();
  });
});

describe('isFailureCause', () => {
  test('failed/interrupted outcomes count; internal repair loops do not', () => {
    expect(svc.isFailureCause('phase_failed:implementer')).toBe(true);
    expect(svc.isFailureCause('auto_run_stop_revert')).toBe(true);
    expect(svc.isFailureCause('plan_critic_exhausted')).toBe(true);
    expect(svc.isFailureCause('verify_repair')).toBe(false);
    expect(svc.isFailureCause('research_critic_failed')).toBe(false);
  });
});
