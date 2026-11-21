/**
 * HomeToolbar.test
 *
 * The toolbar row keeps the due-today card's height on a day with nothing
 * due, when the card shrinks to one line of text, so the create / bulk / auto-run
 * bulk buttons keep the same space around them either way (2026-11-16).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/widgets/TodayTaskProgressBar', () => ({
  default: () => <p data-testid="due-today">本日期限のタスクはありません</p>,
}));
vi.mock('../AutoExecutionMode', () => ({ AutoExecutionMode: () => <button>auto</button> }));
const autoRunState = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('@/hooks/workflow/useThemeAutoRun', () => ({
  useThemeAutoRun: () => ({ data: autoRunState.data }),
}));
vi.mock('../AutoRunProgressStrip', () => ({
  AutoRunProgressStrip: (p: {
    status: string;
    currentTask: { title: string } | null;
    scope?: { theme?: { name: string } } | null;
  }) =>
    p.status === 'running' || p.status === 'paused' ? (
      <div data-testid="strip">
        {p.currentTask?.title}
        {p.scope && <span data-testid="strip-scope">{p.scope.theme?.name}</span>}
      </div>
    ) : null,
}));
vi.mock('../HomeFilterSummary', () => ({
  HomeFilterSummary: (p: { theme?: { name: string } }) => (
    <div data-testid="filter-summary">{p.theme?.name}</div>
  ),
}));
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

// 2026-11-21: task actions and auto-run actions sat in one row in no order, so
// it was unclear which group a button belonged to. Task actions come first,
// then the auto-run control (which draws its own divider).
describe('the action groups', () => {
  it('puts the auto-run control after the task actions', () => {
    render(
      <HomeToolbar
        completedTasksCount={0}
        totalTasksCount={1}
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
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const auto = names.indexOf('auto');
    const create = names.findIndex((n) => n.includes('createTask'));
    const bulk = names.findIndex((n) => n.includes('bulk'));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(bulk).toBeGreaterThanOrEqual(0);
    expect(auto).toBeGreaterThan(create);
    expect(auto).toBeGreaterThan(bulk);
  });

  // 2026-11-21: plain buttons, no frame or label — the auto-run status panel
  // is what sets the other group apart.
  it('keeps the task actions together as plain buttons', () => {
    render(
      <HomeToolbar
        completedTasksCount={0}
        totalTasksCount={1}
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
    const group = document.querySelector('[data-toolbar-group="tasks"]');
    expect(group).toBeTruthy();
    expect(screen.queryByText('toolbarGroup.tasks')).toBeNull();
    expect(group?.className).not.toMatch(/\bbg-/);
    const inside = Array.from(group?.querySelectorAll('button') ?? []).map((b) => b.textContent);
    expect(inside.some((t) => t?.includes('createTask'))).toBe(true);
    expect(inside.some((t) => t?.includes('bulk'))).toBe(true);
    expect(inside).not.toContain('auto');
  });
});

// 2026-11-21 colour pass (docs/design/ui-design-language.md): indigo is the one
// accent for the primary action and the active state; blue is reserved for the
// running state and purple is not in the palette at all.
const toolbar = (isSelectionMode: boolean, selectedTasksSize = 0) =>
  render(
    <HomeToolbar
      completedTasksCount={0}
      totalTasksCount={1}
      hasVisibleTasks
      isSelectionMode={isSelectionMode}
      selectedTasksSize={selectedTasksSize}
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
const buttonWith = (text: string) =>
  screen.getAllByRole('button').find((b) => (b.textContent ?? '').includes(text))!;

describe('toolbar colours', () => {
  it('draws タスクを作成 as the indigo primary action, not blue', () => {
    toolbar(false);
    const cls = buttonWith('createTask').className;
    expect(cls).toContain('shadow-[0_2px_0_0_#a5b4fc]');
    expect(cls).not.toMatch(/blue-/);
  });

  it('draws 一括 as a neutral raised button, never purple', () => {
    toolbar(false);
    const cls = buttonWith('bulk').className;
    expect(cls).toContain('shadow-[0_2px_0_0_#d4d4d8]');
    expect(cls).not.toMatch(/purple-/);
  });

  it('turns 一括 indigo and pressed while selection mode is on', () => {
    toolbar(true, 2);
    const cls = buttonWith('selecting').className;
    expect(cls).toContain('bg-indigo-50');
    expect(cls).toContain('translate-y-[2px]');
    expect(cls).not.toMatch(/purple-/);
  });
});

// 2026-11-21: the panel only said 実行中; the strip under the row shows the
// current task from the same poll that drives the panel.
describe('the auto-run progress strip', () => {
  const withTheme = (isDevelopment: boolean) =>
    render(
      <HomeToolbar
        completedTasksCount={0}
        totalTasksCount={1}
        hasVisibleTasks
        isSelectionMode={false}
        selectedTasksSize={0}
        paginatedTasks={[]}
        themeFilter={null}
        defaultThemeId={undefined}
        autoRunTheme={{ id: 1, isDevelopment }}
        onBulkUpdateStatus={vi.fn()}
        onBulkDelete={vi.fn()}
        onSelectAll={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />,
    );

  it('shows the current task under the toolbar row for a development theme', () => {
    autoRunState.data = {
      autoRun: { status: 'running', startedAt: null },
      currentTask: { id: 9, title: 'いまのタスク', status: 'in-progress', workflowStatus: null },
      remainingCount: 3,
    };
    const { container } = withTheme(true);
    const strip = screen.getByTestId('strip');
    expect(strip.textContent).toBe('いまのタスク');
    expect(container.firstElementChild?.contains(strip)).toBe(false);
    autoRunState.data = null;
  });

  // The row's 62px floor already leaves 12px under the buttons; keeping its
  // mb-3 too put 24px above the strip against 12px below it (2026-11-21).
  it('drops the row margin while the strip shows, keeps it otherwise', () => {
    autoRunState.data = {
      autoRun: { status: 'running', startedAt: null },
      currentTask: null,
      remainingCount: 3,
    };
    withTheme(true);
    const cls = screen.getByTestId('home-toolbar-row').className.split(/\s+/);
    expect(cls).toContain('mb-0');
    expect(cls).not.toContain('mb-3');
    autoRunState.data = null;
  });

  it('keeps the row margin when auto-run is idle', () => {
    autoRunState.data = {
      autoRun: { status: 'idle', startedAt: null },
      currentTask: null,
      remainingCount: 3,
    };
    withTheme(true);
    expect(screen.getByTestId('home-toolbar-row').className.split(/\s+/)).toContain('mb-3');
    autoRunState.data = null;
  });

  it('draws no strip without auto-run data', () => {
    withTheme(true);
    expect(screen.queryByTestId('strip')).toBeNull();
  });
});

// 2026-11-21: with the filter hidden, the line naming the category and theme
// is merged into the auto-run strip rather than drawn as a second band.
describe('the hidden filter merged into the strip', () => {
  const scope = {
    category: { id: 1, name: '開発' },
    theme: { id: 7, name: 'rapitas' },
    onShow: vi.fn(),
  } as unknown as NonNullable<ComponentProps<typeof HomeToolbar>['filterScope']>;

  const withScope = (status: string) => {
    autoRunState.data = {
      autoRun: { status, startedAt: null },
      currentTask: null,
      remainingCount: 3,
    };
    return render(
      <HomeToolbar
        completedTasksCount={0}
        totalTasksCount={1}
        hasVisibleTasks
        isSelectionMode={false}
        selectedTasksSize={0}
        paginatedTasks={[]}
        themeFilter={7}
        defaultThemeId={undefined}
        autoRunTheme={{ id: 7, isDevelopment: true }}
        filterScope={scope}
        onBulkUpdateStatus={vi.fn()}
        onBulkDelete={vi.fn()}
        onSelectAll={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />,
    );
  };

  it('puts the theme into the strip while auto-run runs, with no second band', () => {
    withScope('running');
    expect(screen.getByTestId('strip-scope').textContent).toBe('rapitas');
    expect(screen.queryByTestId('filter-summary')).toBeNull();
    autoRunState.data = null;
  });

  it('shows the theme line alone while auto-run is idle', () => {
    withScope('idle');
    expect(screen.getByTestId('filter-summary').textContent).toBe('rapitas');
    expect(screen.queryByTestId('strip')).toBeNull();
    expect(screen.getByTestId('home-toolbar-row').className.split(/\s+/)).toContain('mb-0');
    autoRunState.data = null;
  });
});

describe('bulk selection keeps every task action in the task group', () => {
  it('puts the status segments inside the タスク管理 frame', () => {
    toolbar(true, 2);
    const group = document.querySelector('[data-toolbar-group="tasks"]');
    const segments = screen.getByTestId('bulk-status-control');
    expect(group?.contains(segments)).toBe(true);
  });
});
