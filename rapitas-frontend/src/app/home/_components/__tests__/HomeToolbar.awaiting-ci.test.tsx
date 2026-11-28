/**
 * HomeToolbar.awaiting-ci.test
 *
 * The CI-wait list from the auto-run state reaches the progress strip, which
 * must appear even while auto-run is idle (task 1570).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/widgets/TodayTaskProgressBar', () => ({ default: () => null }));
vi.mock('../AutoExecutionMode', () => ({ AutoExecutionMode: () => null }));
const autoRunState = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('@/hooks/workflow/useThemeAutoRun', () => ({
  useThemeAutoRun: () => ({ data: autoRunState.data }),
}));
vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: (sel: (s: { isTaskExecuting: () => boolean }) => unknown) =>
    sel({ isTaskExecuting: () => false }),
}));

import { HomeToolbar } from '../HomeToolbar';

function renderIdle(awaitingCi: unknown) {
  autoRunState.data = {
    autoRun: { status: 'idle', startedAt: null },
    currentTask: null,
    remainingCount: 0,
    awaitingCi,
  };
  return render(
    <HomeToolbar
      completedTasksCount={0}
      totalTasksCount={0}
      hasVisibleTasks={false}
      isSelectionMode={false}
      selectedTasksSize={0}
      paginatedTasks={[]}
      themeFilter={18}
      defaultThemeId={undefined}
      autoRunTheme={{ id: 18, isDevelopment: true }}
      onBulkUpdateStatus={vi.fn()}
      onBulkDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onToggleSelectionMode={vi.fn()}
    />,
  );
}

describe('HomeToolbar — CI wait while idle', () => {
  it('passes the list through to the strip', () => {
    renderIdle([{ taskId: 7, title: 'task 7', cause: 'c', since: '2026-11-28T00:00:00Z' }]);

    expect(screen.getByTestId('auto-run-awaiting-ci')).toBeTruthy();
    expect(screen.getByRole('link', { name: '#7 task 7' })).toBeTruthy();
  });

  it.each([
    ['empty', []],
    ['absent (older backend)', undefined],
  ])('draws no strip when the list is %s', (_name, list) => {
    renderIdle(list);
    expect(screen.queryByTestId('auto-run-progress-strip')).toBeNull();
  });
});
