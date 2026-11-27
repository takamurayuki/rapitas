/**
 * AutoRunProgressStrip.select.test
 *
 * Task 1565: with 2+ running tasks in a theme the strip offers a way to
 * switch which task's phase and link it shows; with one it looks as before.
 * 2026-11-27: the wide <select> became the id link plus a chevron menu of the
 * other tasks' ids (no titles), so the strip keeps its height.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ActiveTask, CurrentTask } from '@/hooks/workflow/useThemeAutoRun';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, params?: Record<string, unknown>) =>
    `${namespace}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoRunProgressStrip } = await import('../AutoRunProgressStrip');

const head: CurrentTask = {
  id: 10,
  title: 'head task',
  status: 'in-progress',
  workflowStatus: 'research_done',
};
const both: ActiveTask[] = [
  { id: 10, title: 'head task', role: 'head' },
  { id: 11, title: 'second task', role: 'companion' },
];

function renderStrip(activeTasks?: ActiveTask[], themeId: number | null = 5) {
  const ui = (tasks?: ActiveTask[]) => (
    <AutoRunProgressStrip
      status="running"
      currentTask={head}
      remainingCount={3}
      startedAt={null}
      activeTasks={tasks}
      themeId={themeId}
    />
  );
  const r = render(ui(activeTasks));
  return { ...r, rerenderWith: (tasks?: ActiveTask[]) => r.rerender(ui(tasks)) };
}

// Open the chevron menu and pick a task by id.
function pick(id: number) {
  fireEvent.click(screen.getByRole('button', { name: 'autoRun.progress.selectTask' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `#${id}` }));
}
const shownId = () =>
  screen.getByTestId('auto-run-task-select').querySelector('a')?.textContent ?? null;
const switcher = () => screen.queryByTestId('auto-run-task-select');

const stateOf = (step: string) =>
  document.querySelector('[data-step="' + step + '"]')?.getAttribute('data-step-state');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 11, workflowStatus: 'plan_approved', workflowMode: 'standard' }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AutoRunProgressStrip — task dropdown', () => {
  it('shows the shown id as a link and the other tasks as ids in the menu', () => {
    renderStrip(both);
    expect(shownId()).toBe('#10');
    fireEvent.click(screen.getByRole('button', { name: 'autoRun.progress.selectTask' }));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(['#11']);
    // Titles are not drawn (2026-11-27); they stay only in title / aria-label.
    expect(screen.queryByText(/second task/)).toBeNull();
  });

  it('switches phase and link to the second task when picked', async () => {
    renderStrip(both);
    expect(screen.getByRole('link', { name: /#10/ }).getAttribute('href')).toContain('/tasks/10');
    expect(stateOf('research')).toBe('done');
    pick(11);
    await waitFor(() => expect(stateOf('implement')).toBe('current'));
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links.some((h) => h?.includes('/tasks/11'))).toBe(true);
    expect(links.some((h) => h?.includes('/tasks/10'))).toBe(false);
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('/tasks/11');
  });

  // The frame clips (overflow-hidden); the menu hid under the next card (2026-11-27).
  it('lets the task menu overflow the strip instead of being clipped', () => {
    renderStrip(both);
    expect(screen.getByTestId('auto-run-progress-strip').className).toContain('!overflow-visible');
  });

  it.each([[undefined], [[]], [[both[0]]]])('shows no task menu for %j', (tasks) => {
    renderStrip(tasks as ActiveTask[] | undefined);
    expect(switcher()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(stateOf('research')).toBe('done');
  });

  it('falls back to the head when the picked task leaves the list', async () => {
    const { rerenderWith } = renderStrip(both);
    pick(11);
    await waitFor(() => expect(stateOf('implement')).toBe('current'));
    rerenderWith([both[0]]);
    expect(switcher()).toBeNull();
    expect(screen.getByRole('link', { name: /#10/ }).getAttribute('href')).toContain('/tasks/10');
    expect(stateOf('research')).toBe('done');
  });

  it('remembers the choice per theme', async () => {
    const first = renderStrip(both, 5);
    pick(11);
    await waitFor(() => expect(localStorage.getItem('rapitas:autoRun:selectedTask:5')).toBe('11'));
    first.unmount();
    renderStrip(both, 5);
    expect(shownId()).toBe('#11');
    cleanup();
    renderStrip(both, 6);
    expect(shownId()).toBe('#10');
  });

  it('uses the head when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderStrip(both);
    expect(shownId()).toBe('#10');
  });

  it('3件から2件に減っても選択対象の消失直後に先頭へ戻り、取得を止める', async () => {
    vi.useFakeTimers();
    const third: ActiveTask = { id: 12, title: '並列2', role: 'companion' };
    const { rerenderWith } = renderStrip([...both, third]);
    pick(11);
    await act(async () => {});
    expect(stateOf('implement')).toBe('current');
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    rerenderWith([both[0], third]);
    expect(shownId()).toBe('#10');
    expect(screen.getByRole('link', { name: /#10/ })).toHaveAttribute(
      'href',
      '/tasks/10?showHeader=true',
    );
    expect(stateOf('research')).toBe('done');
    expect(stateOf('implement')).toBe('pending');
    expect(signal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTime(16000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('取得待ちと初回503では全工程を未着手に保つ', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderStrip(both);
    pick(11);
    const states = () => ['research', 'plan', 'implement', 'verify'].map(stateOf);
    expect(states()).toEqual(['pending', 'pending', 'pending', 'pending']);
    await act(async () => finish({ ok: false, status: 503 } as Response));
    expect(states()).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(screen.getByRole('link', { name: /#11/ })).toHaveAttribute(
      'href',
      '/tasks/11?showHeader=true',
    );
  });

  it('取得に成功した実際のnull状態は調査中として表示する', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workflowStatus: null }),
    } as Response);
    renderStrip(both);
    pick(11);
    await act(async () => {});
    expect(stateOf('research')).toBe('current');
  });

  it('8秒ごとに更新し、失敗時は成功値を保ち、アンマウントで取得を止める', async () => {
    vi.useFakeTimers();
    const { unmount } = renderStrip(both);
    expect(fetch).not.toHaveBeenCalled();
    pick(11);
    await act(async () => {});
    expect(stateOf('implement')).toBe('current');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('通信失敗'));
    await act(async () => vi.advanceTimersByTime(8000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stateOf('implement')).toBe('current');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workflowStatus: 'in_progress', workflowMode: 'standard' }),
    } as Response);
    await act(async () => vi.advanceTimersByTime(8000));
    expect(stateOf('verify')).toBe('current');
    const signal = vi.mocked(fetch).mock.calls[2][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTime(16000));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('選択変更前の遅い応答が新しい選択の成功値を上書きしない', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderStrip([...both, { id: 12, title: '並列2', role: 'companion' }]);
    pick(11);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    pick(12);
    await act(async () => {});
    expect(stateOf('implement')).toBe('current');
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      finish({ ok: true, json: async () => ({ workflowStatus: 'draft' }) } as Response),
    );
    expect(shownId()).toBe('#12');
    expect(stateOf('implement')).toBe('current');
  });
});
