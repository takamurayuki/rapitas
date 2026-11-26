/**
 * AutoRunProgressStrip.select.test
 *
 * Task 1565: with 2+ running tasks in a theme the strip offers a dropdown to
 * switch which task's phase and link it shows; with one it looks as before.
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
  it('shows a dropdown with #ID title options, head first, for 2 tasks', () => {
    renderStrip(both);
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['#10 head task', '#11 second task']);
  });

  it('switches phase and link to the second task when picked', async () => {
    renderStrip(both);
    expect(screen.getByRole('link', { name: /#10/ }).getAttribute('href')).toContain('/tasks/10');
    expect(stateOf('research')).toBe('done');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } });
    await waitFor(() => expect(stateOf('implement')).toBe('current'));
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links.some((h) => h?.includes('/tasks/11'))).toBe(true);
    expect(links.some((h) => h?.includes('/tasks/10'))).toBe(false);
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('/tasks/11');
  });

  it.each([[undefined], [[]], [[both[0]]]])('shows no dropdown for %j', (tasks) => {
    renderStrip(tasks as ActiveTask[] | undefined);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(stateOf('research')).toBe('done');
  });

  it('falls back to the head when the picked task leaves the list', async () => {
    const { rerenderWith } = renderStrip(both);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } });
    await waitFor(() => expect(stateOf('implement')).toBe('current'));
    rerenderWith([both[0]]);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('link', { name: /#10/ }).getAttribute('href')).toContain('/tasks/10');
    expect(stateOf('research')).toBe('done');
  });

  it('remembers the choice per theme', async () => {
    const first = renderStrip(both, 5);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } });
    await waitFor(() => expect(localStorage.getItem('rapitas:autoRun:selectedTask:5')).toBe('11'));
    first.unmount();
    renderStrip(both, 5);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('11');
    cleanup();
    renderStrip(both, 6);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('10');
  });

  it('uses the head when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderStrip(both);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('10');
  });

  it('3件から2件に減っても選択対象の消失直後に先頭へ戻り、取得を止める', async () => {
    vi.useFakeTimers();
    const third: ActiveTask = { id: 12, title: '並列2', role: 'companion' };
    const { rerenderWith } = renderStrip([...both, third]);
    await act(async () =>
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } }),
    );
    expect(stateOf('implement')).toBe('current');
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    rerenderWith([both[0], third]);
    expect(screen.getByRole('combobox')).toHaveValue('10');
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } });
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
    await act(async () =>
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } }),
    );
    expect(stateOf('research')).toBe('current');
  });

  it('8秒ごとに更新し、失敗時は成功値を保ち、アンマウントで取得を止める', async () => {
    vi.useFakeTimers();
    const { unmount } = renderStrip(both);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } }),
    );
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11' } });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await act(async () =>
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } }),
    );
    expect(stateOf('implement')).toBe('current');
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      finish({ ok: true, json: async () => ({ workflowStatus: 'draft' }) } as Response),
    );
    expect(screen.getByRole('combobox')).toHaveValue('12');
    expect(stateOf('implement')).toBe('current');
  });
});
