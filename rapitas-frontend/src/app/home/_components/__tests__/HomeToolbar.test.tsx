/**
 * HomeToolbar.test
 *
 * The toolbar row keeps the due-today card's height on a day with nothing
 * due, when the card shrinks to one line of text, so the auto-run / create /
 * bulk buttons keep the same space around them either way (2026-11-16).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/widgets/TodayTaskProgressBar', () => ({
  default: () => <p data-testid="due-today">本日期限のタスクはありません</p>,
}));
vi.mock('../AutoExecutionMode', () => ({ AutoExecutionMode: () => <button>auto</button> }));
vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: (sel: (s: { isTaskExecuting: () => boolean }) => unknown) =>
    sel({ isTaskExecuting: () => false }),
}));

import { HomeToolbar } from '../HomeToolbar';

describe('the toolbar row', () => {
  it('is as tall as the due-today card even when only its sentence shows', () => {
    const { container } = render(
      <HomeToolbar
        completedTasksCount={0}
        totalTasksCount={0}
        hasVisibleTasks
        isSelectionMode={false}
        selectedTasksSize={0}
        paginatedTasks={[]}
        themeFilter={null}
        defaultThemeId={undefined}
        autoRunTheme={null}
        onBulkUpdateStatus={vi.fn()}
        onBulkDelete={vi.fn()}
        onSelectAll={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain('min-h-[62px]');
  });
});
