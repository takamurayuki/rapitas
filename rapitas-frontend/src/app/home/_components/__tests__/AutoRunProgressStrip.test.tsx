/**
 * AutoRunProgressStrip.test
 *
 * The toolbar's auto-run panel only said "実行中", so the user could not tell
 * which task was being worked on, which phase it was in, or how much was left
 * (2026-11-21). The strip under the toolbar shows those while a run is on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AutoRunStatus } from '@/hooks/workflow/useThemeAutoRun';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, params?: Record<string, unknown>) =>
    `${namespace}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoRunProgressStrip } = await import('../AutoRunProgressStrip');

const task = { id: 1682, title: '自動実行パネルに今のタスクを出す', status: 'in-progress' };

function renderStrip(
  status: AutoRunStatus,
  workflowStatus: string | null,
  withTask = true,
  remainingCount = 5,
) {
  return render(
    <AutoRunProgressStrip
      status={status}
      currentTask={withTask ? { ...task, workflowStatus } : null}
      remainingCount={remainingCount}
      startedAt={new Date(Date.now() - 42 * 60_000).toISOString()}
    />,
  );
}

const stepState = (key: string) =>
  document.querySelector(`[data-step="${key}"]`)?.getAttribute('data-step-state');

describe('AutoRunProgressStrip', () => {
  it('shows nothing while auto-run is off', () => {
    const { container } = renderStrip('idle', 'in_progress');
    expect(container.firstChild).toBeNull();
  });

  it('links the current task to its detail page', () => {
    renderStrip('running', 'in_progress');
    const link = screen.getByRole('link', { name: /自動実行パネルに今のタスクを出す/ });
    expect(link.getAttribute('href')).toBe('/tasks/1682?showHeader=true');
  });

  it('marks the implement phase as current once the plan is approved', () => {
    renderStrip('running', 'in_progress');
    expect(stepState('research')).toBe('done');
    expect(stepState('plan')).toBe('done');
    expect(stepState('implement')).toBe('current');
    expect(stepState('verify')).toBe('pending');
  });

  it('shows the plan as waiting for approval', () => {
    renderStrip('running', 'plan_created');
    expect(stepState('research')).toBe('done');
    expect(stepState('plan')).toBe('waiting');
    expect(screen.getByText('autoRun.awaitingApproval')).toBeTruthy();
  });

  it('starts at research for a task that has no workflow status yet', () => {
    renderStrip('running', null);
    expect(stepState('research')).toBe('current');
  });

  it('says it is waiting for an answer when the task asked a question', () => {
    renderStrip('running', 'awaiting_question');
    expect(screen.getByText('autoRun.progress.awaitingAnswer')).toBeTruthy();
  });

  it('says it is choosing the next task when none is current', () => {
    renderStrip('running', null, false);
    expect(screen.getByText('autoRun.progress.choosingNext')).toBeTruthy();
    expect(document.querySelector('[data-step]')).toBeNull();
  });

  it('shows the remaining count and the time since the run started', () => {
    renderStrip('running', 'in_progress');
    expect(screen.getByText(/autoRun\.progress\.remaining\{"count":5\}/)).toBeTruthy();
    expect(screen.getByText(/autoRun\.progress\.elapsedMinutes\{"minutes":42\}/)).toBeTruthy();
  });

  // Design C's mock: a white band with a hairline on top, no outline.
  it('has no outline, only a top hairline', () => {
    renderStrip('running', 'in_progress');
    const cls = screen.getByTestId('auto-run-progress-strip').className.split(/\s+/);
    expect(cls).toContain('border-t');
    expect(cls).not.toContain('border');
    expect(cls.some((c) => c.startsWith('rounded'))).toBe(false);
  });
});
