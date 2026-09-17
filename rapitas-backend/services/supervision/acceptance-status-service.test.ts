/**
 * acceptance-status-service tests
 *
 * `met` is the conjunction of the streak bar (merge-evidenced landings only),
 * sufficient knowledge-reuse evidence, observation evidence, intact intervention
 * writes and no open high-severity concern. A completion recorded at PR creation
 * never counts; this task's own gate change resets the streak; unreadable
 * evidence is reported, never read as success.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPrismaFake, createTimelineFake } from './testing/timeline-fake';

process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'supervision-acceptance-'));

const H = 3_600_000;
// Days after any real gate commit, so git's newest gate commit is not a fresh reset.
const NOW = new Date(Date.now() + 5 * 24 * H);
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

const fake = createTimelineFake(NOW);
const db = createPrismaFake();
let concerns: { total: number } | Error = { total: 0 };
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: db.prisma }));
mock.module('../memory/concern-backlog-service', () => ({
  listConcerns: async () => {
    if (concerns instanceof Error) throw concerns;
    return { concerns: [], total: concerns.total };
  },
}));

const svc = await import('./acceptance-status-service');
const { isGateMutationPath } = await import('./gate-mutation-paths');
type AcceptanceEvidence = import('./acceptance-status-service').AcceptanceEvidence;

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
    landing: { classCounts: {} as never, landings: [] },
    highSeverityOpenConcerns: 0,
  };
}

/** Seeds 72h of heartbeats and a sufficient knowledge-reuse comparison. */
function seedObservation(): void {
  for (let m = 72 * 60; m >= 0; m -= 1) {
    fake.seed({
      eventType: 'supervision_monitor_heartbeat',
      correlationId: 'supervision_monitor_backend',
      createdAt: new Date(NOW.getTime() - m * 60_000),
      payload: {
        schemaVersion: 1,
        monitorId: 'backend',
        sourceKind: 'backend_timer',
        intervalMs: 60_000,
        pid: 1,
        status: 'alive',
      },
    });
  }
  fake.seed({
    eventType: 'supervision_knowledge_reuse_eval',
    correlationId: 'supervision_acceptance',
    createdAt: ago(1),
    payload: {
      schemaVersion: 1,
      evalSetVersion: 'eval-v1',
      methodVersion: 'paired-v1',
      pairedN: 30,
      missingRetainedN: 3,
      successRateWithKB: 0.7,
      successRateWithoutKB: 0.6,
      effectSize: 0.1,
      intervalOrPValue: '[0.01, 0.19]',
      sufficientEvidence: true,
    },
  });
}

/** Seeds 10 top-level tasks completed after verification; `merged` adds merge evidence. */
function seedTasks(merged: boolean): void {
  for (let i = 0; i < 10; i += 1) {
    const id = 100 + i;
    const base = 26 - i * 2;
    db.state.tasks.push({ id, parentId: null, acceptanceCriteria: '["criterion"]' });
    db.state.transitions.push(
      { taskId: id, toStatus: 'in_progress', cause: 'verify_passed', createdAt: ago(base) },
      { taskId: id, toStatus: 'completed', cause: 'file_saved:verify', createdAt: ago(base - 0.1) },
    );
    if (merged) {
      db.state.transitions.push({
        taskId: id,
        toStatus: 'completed',
        cause: 'auto_merged',
        createdAt: ago(base - 0.5),
      });
    }
    db.state.pullRequests.push({ linkedTaskId: id, state: merged ? 'merged' : 'open' });
  }
}

const refresh = () => svc.refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now: NOW });

beforeEach(() => {
  fake.rows.length = 0;
  fake.setNow(NOW);
  db.state.transitions.length = 0;
  db.state.tasks.length = 0;
  db.state.pullRequests.length = 0;
  db.state.autoMergePRDefault = true;
  db.state.failPullRequests = false;
  db.state.failUserSettings = false;
  concerns = { total: 0 };
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

  test('an unreadable concern backlog is treated as an open high-severity concern', () => {
    const e = evidence({ streakOk: true, knowledgeOk: true });
    e.highSeverityOpenConcerns = null;
    const s = svc.evaluateAcceptance(e);
    expect(s.met).toBe(false);
    expect(s.reasonCodes).toContain('unresolved_high_severity_concern');
    expect(s.denominators.highSeverityOpenConcerns).toBeNull();
  });
});

describe('self gate mutation (task 904 landing)', () => {
  test('the files this task changes are gate paths', () => {
    for (const p of [
      'rapitas-backend/services/supervision/acceptance-status-service.ts',
      'rapitas-backend/services/supervision/task-landing-classifier.ts',
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

describe('refreshAcceptanceSnapshot with landing evidence', () => {
  test('10 completions recorded at PR creation (no merge) count as 0 and are unmet', async () => {
    seedObservation();
    seedTasks(false);
    const s = await refresh();
    expect(s?.streakCount).toBe(0);
    expect(s?.met).toBe(false);
    expect(s?.reasonCodes).toContain('landing_evidence_pending');
    expect(s?.denominators.landingPendingTaskIds).toBe('100,101,102,103,104,105,106,107,108,109');
    expect(JSON.parse(String(s?.denominators.landingClassCounts)).landing_pending).toBe(10);
  });

  test('10 merge-evidenced landings over 72h observed with sufficient evidence are met', async () => {
    seedObservation();
    seedTasks(true);
    const s = await refresh();
    expect(s?.reasonCodes).toEqual([]);
    expect(s?.met).toBe(true);
    expect(s?.streakCount).toBe(10);
    expect(s?.denominators.landingQualifiedTaskIds).toBe('100,101,102,103,104,105,106,107,108,109');
    expect(s?.denominators.highSeverityOpenConcerns).toBe(0);
  });

  test('an open high-severity concern fails an otherwise met verdict', async () => {
    seedObservation();
    seedTasks(true);
    concerns = { total: 1 };
    const s = await refresh();
    expect(s?.met).toBe(false);
    expect(s?.reasonCodes).toEqual(['unresolved_high_severity_concern']);
  });

  test('a concern backlog read failure is fail-closed', async () => {
    seedObservation();
    seedTasks(true);
    concerns = new Error('backlog down');
    const s = await refresh();
    expect(s?.reasonCodes).toContain('unresolved_high_severity_concern');
  });

  test('a PR mirror read failure is landing_evidence_unobservable, not merge_not_requested', async () => {
    seedObservation();
    seedTasks(true);
    db.state.failPullRequests = true;
    const s = await refresh();
    expect(s?.met).toBe(false);
    expect(s?.reasonCodes).toContain('landing_evidence_unobservable');
    expect(s?.reasonCodes).not.toContain('merge_not_requested');
    expect(s?.streakCount).toBe(0);
  });

  test('with no evidence at all it persists an unmet snapshot with no_observation_evidence', async () => {
    const s = await refresh();
    expect(s?.met).toBe(false);
    expect(s?.reasonCodes).toContain('no_observation_evidence');
    expect(s?.reasonCodes).toContain('knowledge_reuse_evidence_insufficient');
    expect(fake.rows.some((r) => r.eventType === 'supervision_acceptance_snapshot')).toBe(true);
  });

  test('a failed snapshot write returns null without throwing', async () => {
    fake.failNextAppends(1, 'supervision_acceptance_snapshot');
    expect(await refresh()).toBeNull();
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
