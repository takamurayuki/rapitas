/**
 * useHomeActions — toggleTaskSelection execution guard
 *
 * Auto-executing tasks must stay out of the bulk-selection set: an
 * unintended bulk status change mid-execution could cause the agent to
 * misbehave. TaskCard's checkbox is already disabled for these (see
 * TaskCard.test.tsx); this covers the handler itself, the guard other
 * callers of onToggleSelect also go through.
 */
import { renderHook, act } from '@testing-library/react';
import { useHomeActions } from '../useHomeActions';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import type { Task } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => vi.fn().mockResolvedValue(true),
}));

function setup(selectedTasks: Set<number> = new Set()) {
  const setSelectedTasks = vi.fn();
  const { result } = renderHook(() =>
    useHomeActions({
      tasks: [] as Task[],
      themes: [],
      categoryFilter: null,
      isSelectionMode: true,
      selectedTasks,
      setSelectedTasks,
      setIsSelectionMode: vi.fn(),
      triggerTaskCompletion: vi.fn(),
      isTodayTask: () => false,
      fetchTasks: vi.fn(),
    }),
  );
  return { result, setSelectedTasks };
}

describe('useHomeActions — toggleTaskSelection', () => {
  beforeEach(() => {
    useExecutionStateStore.setState({
      executingTasks: new Map(),
      loadingTaskIds: new Set(),
      liveQuestions: new Map(),
      answeredAt: new Map(),
    });
  });

  it('adds a non-executing task to the selection', () => {
    const { result, setSelectedTasks } = setup();
    act(() => result.current.toggleTaskSelection(1));
    expect(setSelectedTasks).toHaveBeenCalledWith(new Set([1]));
  });

  it('does not add an auto-executing task to the selection', () => {
    useExecutionStateStore.getState().setExecutingTask({ taskId: 1, status: 'running' });
    const { result, setSelectedTasks } = setup();
    act(() => result.current.toggleTaskSelection(1));
    expect(setSelectedTasks).not.toHaveBeenCalled();
  });

  it('still allows deselecting a task that was already selected (defensive, not a normal path)', () => {
    useExecutionStateStore.getState().setExecutingTask({ taskId: 1, status: 'running' });
    const { result, setSelectedTasks } = setup(new Set([1]));
    act(() => result.current.toggleTaskSelection(1));
    expect(setSelectedTasks).toHaveBeenCalledWith(new Set());
  });
});
