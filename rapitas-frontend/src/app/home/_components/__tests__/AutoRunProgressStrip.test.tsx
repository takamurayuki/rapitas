/**
 * AutoRunProgressStrip.test
 *
 * The toolbar's auto-run panel only said "実行中", so the user could not tell
 * which task was being worked on, which phase it was in, or how much was left
 * (2026-11-21). The strip under the toolbar shows those while a run is on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AutoRunStatus, CurrentTask } from '@/hooks/workflow/useThemeAutoRun';
import type { Category, Theme } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, params?: Record<string, unknown>) =>
    `${namespace}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoRunProgressStrip } = await import('../AutoRunProgressStrip');
const { HOME_CARD_FRAME } = await import('../home-card-frame');

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

function renderTask(extra: Partial<CurrentTask>) {
  return render(
    <AutoRunProgressStrip
      status="running"
      currentTask={{ ...task, workflowStatus: null, ...extra }}
      remainingCount={5}
      startedAt={null}
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

  // Each task runs its own workflow: lightweight has no plan phase.
  it('draws only research, implement and verify for a lightweight task', () => {
    renderTask({ workflowStatus: 'research_done', workflowMode: 'lightweight' });
    expect(document.querySelector('[data-step="plan"]')).toBeNull();
    expect(stepState('research')).toBe('done');
    expect(stepState('implement')).toBe('current');
  });

  it('moves to the plan after research for a standard task', () => {
    renderTask({ workflowStatus: 'research_done', workflowMode: 'standard' });
    expect(stepState('plan')).toBe('current');
  });

  // A send-back restarts from where it was sent, even past a finished phase.
  it('shows a send-back and redoes the phases after it', () => {
    renderTask({
      workflowStatus: 'in_progress',
      workflowMode: 'comprehensive',
      rework: {
        count: 2,
        lastFromStatus: 'verify_done',
        lastToStatus: 'in_progress',
        lastCause: 'ci_repair',
        lastAt: '2026-11-21T00:00:00.000Z',
      },
    });
    expect(stepState('implement')).toBe('current');
    expect(stepState('verify')).toBe('pending');
    expect(screen.getByText(/autoRun\.progress\.rework\{"count":2\}/)).toBeTruthy();
    expect(
      screen.getByText(
        /autoRun\.progress\.reworkRoute\{"from":"autoRun\.progress\.steps\.verify","to":"autoRun\.progress\.steps\.implement"\}/,
      ),
    ).toBeTruthy();
  });

  it('shows no send-back for a task that only moved forward', () => {
    renderTask({ workflowStatus: 'in_progress', workflowMode: 'standard', rework: null });
    expect(screen.queryByText(/autoRun\.progress\.rework/)).toBeNull();
  });

  // 2026-11-21: with the filter hidden, the category and theme lead the strip
  // and a short "show" control ends it, instead of a second band.
  it('leads with the hidden filter scope and offers to show it', () => {
    const onShow = vi.fn();
    render(
      <AutoRunProgressStrip
        status="running"
        currentTask={{ ...task, workflowStatus: 'in_progress' }}
        remainingCount={5}
        startedAt={null}
        scope={{
          category: { id: 1, name: '開発', color: '#2563eb', icon: '' } as unknown as Category,
          theme: { id: 7, name: 'rapitas', color: '#f97316' } as unknown as Theme,
          onShow,
        }}
      />,
    );
    const strip = screen.getByTestId('auto-run-progress-strip');
    expect(strip.textContent?.indexOf('rapitas')).toBeLessThan(
      strip.textContent?.indexOf('#1682') ?? -1,
    );
    fireEvent.click(screen.getByRole('button', { name: 'home.filterPanel.show' }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('offers no show control while the filter is shown', () => {
    renderStrip('running', 'in_progress');
    expect(screen.queryByRole('button', { name: 'home.filterPanel.show' })).toBeNull();
  });

  // Asked 2026-11-21: the same card as the filter below it, for one look.
  it('is drawn in the filter card frame', () => {
    renderStrip('running', 'in_progress');
    const cls = screen.getByTestId('auto-run-progress-strip').className.split(/\s+/);
    for (const c of HOME_CARD_FRAME.split(/\s+/)) expect(cls).toContain(c);
    expect(cls).not.toContain('border-t');
  });
});
