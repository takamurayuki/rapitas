/**
 * useTaskActions — a failed status change must be visible
 *
 * Found by the browser E2E (#1418): when PATCH /tasks/:id failed,
 * updateStatus quietly reverted the optimistic status and only logged, so the
 * user saw the button flick back with no explanation, and a "done" change
 * left the completion overlay up for a save that never happened.
 */
import { renderHook, act } from '@testing-library/react';
import type { Task } from '@/types';
import { useTaskActions } from '../useTaskActions';

const showToast = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => vi.fn(),
}));
vi.mock('../useTaskEdit', () => ({ useTaskEdit: () => ({}) }));
vi.mock('../useSubtaskManagement', () => ({ useSubtaskManagement: () => ({}) }));
vi.mock('@/lib/api-client', () => ({ clearApiCache: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const task = { id: 7, title: 't', status: 'todo', subtasks: [] } as unknown as Task;

function setup(ok: boolean) {
  const setTask = vi.fn();
  const setShowCompleteOverlay = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({}) })),
  );
  const { result } = renderHook(() =>
    useTaskActions({
      task,
      resolvedTaskId: '7',
      setTask,
      isThisTaskTimer: false,
      pomodoroState: { isTimerRunning: false },
      stopTimer: vi.fn(),
      setShowCompleteOverlay,
    }),
  );
  return { result, setTask, setShowCompleteOverlay };
}

beforeEach(() => showToast.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('useTaskActions.updateStatus failure', () => {
  it('tells the user and reverts when the save fails', async () => {
    const { result, setTask } = setup(false);
    await act(() => result.current.updateStatus(7, 'in-progress'));
    expect(showToast).toHaveBeenCalledWith('statusUpdateFailed', 'error');
    expect(setTask).toHaveBeenLastCalledWith(task);
  });

  it('takes the completion overlay down when a "done" save fails', async () => {
    const { result, setShowCompleteOverlay } = setup(false);
    await act(() => result.current.updateStatus(7, 'done'));
    expect(setShowCompleteOverlay).toHaveBeenCalledWith(true);
    expect(setShowCompleteOverlay).toHaveBeenLastCalledWith(false);
  });

  it('shows nothing when the save succeeds', async () => {
    const { result } = setup(true);
    await act(() => result.current.updateStatus(7, 'in-progress'));
    expect(showToast).not.toHaveBeenCalled();
  });
});
