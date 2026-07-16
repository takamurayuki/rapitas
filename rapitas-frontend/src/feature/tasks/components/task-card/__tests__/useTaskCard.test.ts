/**
 * useTaskCard.test.ts
 *
 * サブタスクの同期・楽観更新、実行状態ストアに応じた表示分岐（実行中/入力待ち
 * /アイドル）、ホバー時プリフェッチのガード、複製・削除の成功/失敗パスを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskCard } from '../useTaskCard';
import type { Task } from '@/types';

const { showToast, confirmDialog, prefetch, loggerError, mockStoreState } = vi.hoisted(() => ({
  showToast: vi.fn(),
  confirmDialog: vi.fn(),
  prefetch: vi.fn(),
  loggerError: vi.fn(),
  mockStoreState: {
    status: null as string | null,
    startedAt: null as string | null,
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/feature/tasks/config/StatusConfig', () => ({
  getStatusDisplay: (t: (key: string) => string, status: string) => ({
    color: 'text-zinc-700',
    bgColor: 'bg-zinc-100',
    borderColor: `border-l-${status}`,
    label: t(`status.${status}`),
  }),
}));

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => confirmDialog,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('@/lib/api-client', () => ({
  prefetch: (...args: unknown[]) => prefetch(...args),
}));

vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: (
    selector: (state: {
      getExecutingTaskStatus: (id: number) => string | null;
      getExecutingTaskStartedAt: (id: number) => string | null;
    }) => unknown,
  ) =>
    selector({
      getExecutingTaskStatus: () => mockStoreState.status,
      getExecutingTaskStartedAt: () => mockStoreState.startedAt,
    }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: loggerError, info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../completion/TaskCompletionAnimation', () => ({
  useProgressColors: () => ({ primary: '#000', primaryLight: '#111', primaryDark: '#222' }),
}));

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    labels: '[]',
    isProtected: false,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  }) as Task;

describe('useTaskCard', () => {
  const onStatusChange = vi.fn();
  const onTaskUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.status = null;
    mockStoreState.startedAt = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('初期状態とサブタスク同期', () => {
    it('subtasksが未指定の場合localSubtasksは空配列であること', () => {
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.localSubtasks).toEqual([]);
      expect(result.current.showContextMenu).toBe(false);
      expect(result.current.expandedSubtasks).toBe(false);
    });

    it('task.subtasksの変更に追従してlocalSubtasksが更新されること', () => {
      const subtask = createMockTask({ id: 2, title: 'Sub' });
      const task = createMockTask({ subtasks: [subtask] });
      const { result, rerender } = renderHook(
        ({ t }: { t: Task }) => useTaskCard(t, onStatusChange, onTaskUpdated),
        { initialProps: { t: task } },
      );

      expect(result.current.localSubtasks).toEqual([subtask]);

      const newSubtask = createMockTask({ id: 3, title: 'Sub2' });
      rerender({ t: createMockTask({ subtasks: [newSubtask] }) });

      expect(result.current.localSubtasks).toEqual([newSubtask]);
    });

    it('handleSubtaskStatusChangeは対象サブタスクのみを楽観更新し、onStatusChangeを呼ぶこと', () => {
      const sub1 = createMockTask({ id: 2, status: 'todo' });
      const sub2 = createMockTask({ id: 3, status: 'todo' });
      const task = createMockTask({ subtasks: [sub1, sub2] });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      act(() => result.current.handleSubtaskStatusChange(2, 'done'));

      expect(result.current.localSubtasks.find((s) => s.id === 2)?.status).toBe('done');
      expect(result.current.localSubtasks.find((s) => s.id === 3)?.status).toBe('todo');
      expect(onStatusChange).toHaveBeenCalledWith(2, 'done');
    });
  });

  describe('実行状態の表示分岐', () => {
    it('ストアの実行状態がnullの場合、executionClassesはnullでボーダーは通常ステータス由来になること', () => {
      const task = createMockTask({ status: 'in-progress' });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.executionStatus).toBeNull();
      expect(result.current.executionClasses).toBeNull();
      expect(result.current.isWaitingForInput).toBe(false);
      expect(result.current.cardBorderColor).toBe('border-l-in-progress');
    });

    it('running状態の場合はblue系のexecutionClassesになること', () => {
      mockStoreState.status = 'running';
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.executionClasses).toEqual({
        borderColor: 'blue',
        badgeClass: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
        dotClass: 'bg-blue-500',
        label: 'running',
      });
      expect(result.current.isWaitingForInput).toBe(false);
    });

    it('waiting_for_input状態の場合はamber系になり、カードボーダーがamberに切り替わること', () => {
      mockStoreState.status = 'waiting_for_input';
      const task = createMockTask({ status: 'todo' });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.isWaitingForInput).toBe(true);
      expect(result.current.executionClasses?.borderColor).toBe('amber');
      expect(result.current.cardBorderColor).toBe(result.current.waitingAmberConfig.borderColor);
    });

    it('startedAtがある場合、実行中はexecutionElapsedが文字列になること', () => {
      mockStoreState.status = 'running';
      mockStoreState.startedAt = new Date(Date.now() - 5000).toISOString();
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.executionElapsed).toMatch(/^\d+:\d{2}$/);
    });

    it('実行中でない場合、executionElapsedはnullであること', () => {
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      expect(result.current.executionElapsed).toBeNull();
    });
  });

  describe('handleMouseEnter', () => {
    it('初回呼び出しでタスク自身のパスをプリフェッチすること', async () => {
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.handleMouseEnter();
      });

      expect(prefetch).toHaveBeenCalledWith(['/tasks/1'], 24 * 60 * 60 * 1000);
      expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('サブタスクがある場合はサブタスクのパスもプリフェッチすること', async () => {
      const subtask = createMockTask({ id: 2 });
      const task = createMockTask({ subtasks: [subtask] });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.handleMouseEnter();
      });

      expect(prefetch).toHaveBeenCalledWith(['/tasks/2'], 24 * 60 * 60 * 1000);
      expect(prefetch).toHaveBeenCalledTimes(2);
    });

    it('2回目以降の呼び出しでは再度プリフェッチしないこと（ガード）', async () => {
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.handleMouseEnter();
      });
      await act(async () => {
        await result.current.handleMouseEnter();
      });

      expect(prefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicateTask', () => {
    it('成功時はトースト表示・onTaskUpdated呼び出し・コンテキストメニューを閉じること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ title: 'Original' });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      act(() => result.current.setShowContextMenu(true));
      await act(async () => {
        await result.current.duplicateTask();
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/tasks',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Original'),
        }),
      );
      expect(showToast).toHaveBeenCalledWith('duplicated', 'success');
      expect(onTaskUpdated).toHaveBeenCalledTimes(1);
      expect(result.current.showContextMenu).toBe(false);
    });

    it('レスポンスが失敗の場合はエラートーストを表示し、onTaskUpdatedを呼ばないこと', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.duplicateTask();
      });

      expect(showToast).toHaveBeenCalledWith('duplicateFailed', 'error');
      expect(onTaskUpdated).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalled();
    });

    it('fetchが例外を投げた場合もエラートーストを表示すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.duplicateTask();
      });

      expect(showToast).toHaveBeenCalledWith('duplicateFailed', 'error');
    });
  });

  describe('deleteTask', () => {
    it('保護タスクの場合は確認ダイアログを出さずエラートーストを表示すること', async () => {
      const task = createMockTask({ isProtected: true });
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      act(() => result.current.setShowContextMenu(true));
      await act(async () => {
        await result.current.deleteTask();
      });

      expect(confirmDialog).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('taskCard.protectedDeleteError', 'error');
      expect(fetch).not.toHaveBeenCalled();
      expect(result.current.showContextMenu).toBe(false);
    });

    it('確認ダイアログでキャンセルした場合は削除しないこと', async () => {
      confirmDialog.mockResolvedValue(false);
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.deleteTask();
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it('確認して削除成功した場合はトースト表示・onTaskUpdated呼び出し・メニューを閉じること', async () => {
      confirmDialog.mockResolvedValue(true);
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      act(() => result.current.setShowContextMenu(true));
      await act(async () => {
        await result.current.deleteTask();
      });

      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/tasks/1', { method: 'DELETE' });
      expect(showToast).toHaveBeenCalledWith('taskDeleted', 'success');
      expect(onTaskUpdated).toHaveBeenCalledTimes(1);
      expect(result.current.showContextMenu).toBe(false);
    });

    it('削除に失敗した場合はエラートーストを表示すること', async () => {
      confirmDialog.mockResolvedValue(true);
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
      const task = createMockTask();
      const { result } = renderHook(() => useTaskCard(task, onStatusChange, onTaskUpdated));

      await act(async () => {
        await result.current.deleteTask();
      });

      expect(showToast).toHaveBeenCalledWith('deleteFailed', 'error');
      expect(onTaskUpdated).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalled();
    });
  });
});
