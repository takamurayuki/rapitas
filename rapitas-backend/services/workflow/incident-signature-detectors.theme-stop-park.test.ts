/**
 * incident-signature-detectors.theme-stop-park.test
 *
 * Pattern B must not re-fire on a task deliberately parked by a theme-stop request (#1010).
 */
import { describe, it, expect } from 'bun:test';
import { detectTriStateDesync } from './incident-signature-detectors';

const NOW = Date.parse('2026-09-20T09:00:00Z');
const HOUR = 3_600_000;
const base = {
  taskStatus: 'todo',
  workflowStatus: 'in_progress',
  latestSessionStatus: 'completed',
  latestExecutionStatus: 'completed',
  themeAutoRunEnabled: true,
  nowMs: NOW,
};

describe('pattern B vs theme-stop parking (#1010)', () => {
  it('does not fire when the newest transition is a theme stop past the grace window', () => {
    const r = detectTriStateDesync({
      ...base,
      recentTransitions: [
        { cause: 'theme_stop_execution_requested', createdAtMs: NOW - 10 * HOUR },
        { cause: 'blocked_escalated', createdAtMs: NOW - 11 * HOUR },
      ],
    });
    expect(r).toBeNull();
  });

  it('still fires when a later transition superseded the theme stop', () => {
    const r = detectTriStateDesync({
      ...base,
      recentTransitions: [
        { cause: 'theme_stop_execution_requested', createdAtMs: NOW - 10 * HOUR },
        { cause: 'phase_completed:implementer', createdAtMs: NOW - 5 * HOUR },
      ],
    });
    expect(r?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still fires without any theme-stop transition', () => {
    const r = detectTriStateDesync({
      ...base,
      recentTransitions: [{ cause: 'blocked_escalated', createdAtMs: NOW - 10 * HOUR }],
    });
    expect(r?.kind).toBe('todo_status_workflow_advanced');
  });
});
