/**
 * boundary-policy.test
 *
 * Pure-function coverage for the task-boundary restart policy: merge urgency
 * classification (loop machinery vs UI-only), the quiescence gate order, the
 * UI-activity defer counter with its ceiling, boundary values for the rate
 * limit and UI-quiet windows, and the env resolvers.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  classifyMergeUrgency,
  decideBoundaryRestart,
  resolveRestartMinIntervalMs,
  resolveRestartUiQuietMs,
  resolveRestartMaxDeferrals,
  type BoundaryRestartInput,
} from './boundary-policy';

// ── classifyMergeUrgency ─────────────────────────────────────────────────────

describe('classifyMergeUrgency', () => {
  test('empty list classifies as boundary (unknown = wait, the safe side)', () => {
    expect(classifyMergeUrgency([])).toBe('boundary');
  });

  test('null / undefined classify as boundary', () => {
    expect(classifyMergeUrgency(null)).toBe('boundary');
    expect(classifyMergeUrgency(undefined)).toBe('boundary');
  });

  test('UI-only changes classify as boundary', () => {
    expect(
      classifyMergeUrgency([
        'rapitas-frontend/src/components/task-card/task-card.tsx',
        'rapitas-frontend/src/app/dashboard/page.tsx',
        'rapitas-frontend/src/lib/api-client/client.ts',
      ]),
    ).toBe('boundary');
  });

  test.each([
    ['rapitas-backend/services/workflow/workflow-runner.ts'],
    ['rapitas-backend/services/scheduling/backlog-scheduler.ts'],
    ['rapitas-backend/services/workflow/auto-run/theme-auto-run-scheduler.ts'],
    ['rapitas-backend/services/workflow/auto-merge-watcher.ts'],
    ['rapitas-backend/services/system/shutdown-sequence.ts'],
    ['rapitas-desktop/scripts/restart-loop-smoke.cjs'],
    ['rapitas-desktop/scripts/dev.js'],
  ])('loop-machinery path %s classifies as immediate', (path) => {
    expect(classifyMergeUrgency([path])).toBe('immediate');
  });

  test('mixed UI + machinery classifies as immediate (machinery wins)', () => {
    expect(
      classifyMergeUrgency([
        'rapitas-frontend/src/app/page.tsx',
        'rapitas-backend/services/workflow/workflow-runner.ts',
      ]),
    ).toBe('immediate');
  });

  test('normalizes backslashes, leading ./ and case before matching', () => {
    expect(classifyMergeUrgency(['.\\rapitas-backend\\Services\\Workflow\\runner.ts'])).toBe(
      'immediate',
    );
    expect(classifyMergeUrgency(['./rapitas-desktop/scripts/DEV.JS'])).toBe('immediate');
  });

  test('dev.js matches as a basename only — somedev.js stays boundary', () => {
    expect(classifyMergeUrgency(['dev.js'])).toBe('immediate');
    expect(classifyMergeUrgency(['rapitas-frontend/src/somedev.js'])).toBe('boundary');
  });

  test('services/agents/ is NOT loop machinery (stays boundary)', () => {
    expect(classifyMergeUrgency(['rapitas-backend/services/agents/agent-orchestrator.ts'])).toBe(
      'boundary',
    );
  });
});

// ── decideBoundaryRestart ────────────────────────────────────────────────────

/** Fully quiescent baseline; individual tests override one gate at a time. */
function quietInput(overrides: Partial<BoundaryRestartInput> = {}): BoundaryRestartInput {
  return {
    aheadCount: 2,
    isShuttingDown: false,
    activeExecutions: 0,
    runningExecutions: 0,
    queueDepth: 0,
    auxChildren: 0,
    isMerging: false,
    msSinceLastRestart: null,
    minRestartIntervalMs: 600_000,
    msSinceLastUiActivity: null,
    uiQuietMs: 180_000,
    deferCount: 0,
    maxDeferrals: 5,
    ...overrides,
  };
}

describe('decideBoundaryRestart — quiescence gates', () => {
  test('all quiet: restart with reason ok and defer count reset to 0', () => {
    expect(decideBoundaryRestart(quietInput({ deferCount: 3 }))).toEqual({
      action: 'restart',
      reason: 'ok',
      nextDeferCount: 0,
    });
  });

  test.each([
    [{ aheadCount: 0 }, 'no-unactivated-commits'],
    [{ isShuttingDown: true }, 'already-shutting-down'],
    [{ activeExecutions: 1 }, 'active-executions'],
    [{ runningExecutions: 1 }, 'running-executions'],
    [{ queueDepth: 1 }, 'queue-not-empty'],
    [{ auxChildren: 1 }, 'aux-cli-children-alive'],
    [{ isMerging: true }, 'auto-merge-in-progress'],
    [{ msSinceLastRestart: 1 }, 'rate-limited'],
  ] as Array<[Partial<BoundaryRestartInput>, string]>)(
    'single violation %j waits with reason %s and keeps the defer count',
    (overrides, reason) => {
      const decision = decideBoundaryRestart(quietInput({ ...overrides, deferCount: 2 }));
      expect(decision).toEqual({ action: 'wait', reason, nextDeferCount: 2 });
    },
  );

  test('first failing gate wins (active-executions before aux-cli-children-alive)', () => {
    const decision = decideBoundaryRestart(quietInput({ activeExecutions: 1, auxChildren: 3 }));
    expect(decision.reason).toBe('active-executions');
  });

  test('boundary value: msSinceLastRestart === minRestartIntervalMs is NOT rate-limited', () => {
    const decision = decideBoundaryRestart(quietInput({ msSinceLastRestart: 600_000 }));
    expect(decision.action).toBe('restart');
    expect(decision.reason).toBe('ok');
  });

  test('null msSinceLastRestart (never restarted) is not rate-limited', () => {
    expect(decideBoundaryRestart(quietInput({ msSinceLastRestart: null })).action).toBe('restart');
  });
});

describe('decideBoundaryRestart — UI activity and deferrals', () => {
  test('UI active below the ceiling: defer and increment the count', () => {
    const decision = decideBoundaryRestart(
      quietInput({ msSinceLastUiActivity: 10_000, deferCount: 0 }),
    );
    expect(decision).toEqual({ action: 'defer', reason: 'ui-active-deferred', nextDeferCount: 1 });
  });

  test('defer keeps incrementing up to the ceiling', () => {
    const decision = decideBoundaryRestart(
      quietInput({ msSinceLastUiActivity: 10_000, deferCount: 4, maxDeferrals: 5 }),
    );
    expect(decision).toEqual({ action: 'defer', reason: 'ui-active-deferred', nextDeferCount: 5 });
  });

  test('UI active at the ceiling: forced restart with count reset', () => {
    const decision = decideBoundaryRestart(
      quietInput({ msSinceLastUiActivity: 10_000, deferCount: 5, maxDeferrals: 5 }),
    );
    expect(decision).toEqual({ action: 'restart', reason: 'ui-active-forced', nextDeferCount: 0 });
  });

  test('maxDeferrals 0: UI activity never defers, restart is forced immediately', () => {
    const decision = decideBoundaryRestart(
      quietInput({ msSinceLastUiActivity: 10_000, deferCount: 0, maxDeferrals: 0 }),
    );
    expect(decision).toEqual({ action: 'restart', reason: 'ui-active-forced', nextDeferCount: 0 });
  });

  test('boundary value: msSinceLastUiActivity === uiQuietMs counts as quiet', () => {
    const decision = decideBoundaryRestart(quietInput({ msSinceLastUiActivity: 180_000 }));
    expect(decision).toEqual({ action: 'restart', reason: 'ok', nextDeferCount: 0 });
  });

  test('null msSinceLastUiActivity (never recorded) counts as quiet (fail-open)', () => {
    const decision = decideBoundaryRestart(
      quietInput({ msSinceLastUiActivity: null, deferCount: 2 }),
    );
    expect(decision).toEqual({ action: 'restart', reason: 'ok', nextDeferCount: 0 });
  });

  test('system-busy wait takes precedence over UI activity (no defer increment)', () => {
    const decision = decideBoundaryRestart(
      quietInput({ auxChildren: 1, msSinceLastUiActivity: 10_000, deferCount: 3 }),
    );
    expect(decision).toEqual({
      action: 'wait',
      reason: 'aux-cli-children-alive',
      nextDeferCount: 3,
    });
  });
});

// ── env resolvers ────────────────────────────────────────────────────────────

const ENV_KEYS = [
  'RAPITAS_RESTART_MIN_INTERVAL_MS',
  'RAPITAS_RESTART_UI_QUIET_MS',
  'RAPITAS_RESTART_MAX_DEFERRALS',
] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

describe('env resolvers', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  test('defaults: 10 min interval, 3 min UI quiet, 5 deferrals', () => {
    expect(resolveRestartMinIntervalMs()).toBe(600_000);
    expect(resolveRestartUiQuietMs()).toBe(180_000);
    expect(resolveRestartMaxDeferrals()).toBe(5);
  });

  test('valid overrides are honoured', () => {
    process.env.RAPITAS_RESTART_MIN_INTERVAL_MS = '120000';
    process.env.RAPITAS_RESTART_UI_QUIET_MS = '60000';
    process.env.RAPITAS_RESTART_MAX_DEFERRALS = '2';
    expect(resolveRestartMinIntervalMs()).toBe(120_000);
    expect(resolveRestartUiQuietMs()).toBe(60_000);
    expect(resolveRestartMaxDeferrals()).toBe(2);
  });

  test('invalid values fall back to defaults', () => {
    process.env.RAPITAS_RESTART_MIN_INTERVAL_MS = 'abc';
    process.env.RAPITAS_RESTART_UI_QUIET_MS = '-500';
    process.env.RAPITAS_RESTART_MAX_DEFERRALS = 'many';
    expect(resolveRestartMinIntervalMs()).toBe(600_000);
    expect(resolveRestartUiQuietMs()).toBe(180_000);
    expect(resolveRestartMaxDeferrals()).toBe(5);
  });

  test('zero: rejected for intervals, accepted for maxDeferrals', () => {
    process.env.RAPITAS_RESTART_MIN_INTERVAL_MS = '0';
    process.env.RAPITAS_RESTART_MAX_DEFERRALS = '0';
    expect(resolveRestartMinIntervalMs()).toBe(600_000);
    expect(resolveRestartMaxDeferrals()).toBe(0);
  });

  test('negative maxDeferrals falls back to 5', () => {
    process.env.RAPITAS_RESTART_MAX_DEFERRALS = '-1';
    expect(resolveRestartMaxDeferrals()).toBe(5);
  });
});
