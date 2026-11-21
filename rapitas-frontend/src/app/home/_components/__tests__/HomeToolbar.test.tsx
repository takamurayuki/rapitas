/**
 * HomeToolbar.test
 *
 * The toolbar row keeps the due-today card's height on a day with nothing
 * due, when the card shrinks to one line of text, so the create / bulk / auto-run
 * bulk buttons keep the same space around them either way (2026-11-16).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

  it('wraps the task actions in their own labelled group', () => {
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
    const group = screen.getByText('toolbarGroup.tasks').closest('[data-toolbar-group]');
    expect(group?.getAttribute('data-toolbar-group')).toBe('tasks');
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

describe('bulk selection keeps every task action in the task group', () => {
  it('puts the status segments inside the タスク管理 frame', () => {
    toolbar(true, 2);
    const group = screen.getByText('toolbarGroup.tasks').closest('[data-toolbar-group]');
    const segments = screen.getByTestId('bulk-status-control');
    expect(group?.contains(segments)).toBe(true);
  });
});
