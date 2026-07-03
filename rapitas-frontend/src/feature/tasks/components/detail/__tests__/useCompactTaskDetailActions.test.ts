/**
 * useCompactTaskDetailActions.test.ts
 *
 * PATCH ベースの patchTask/saveField/toggleProtected/insertLinkToDescription が
 * 成功・失敗の両パスでキャッシュ更新・トースト通知・親コールバックを適切に
 * 呼び出すかを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCompactTaskDetailActions } from '../useCompactTaskDetailActions';
import type { Task } from '@/types';

const showToast = vi.fn();
const updateTaskLocally = vi.fn();
const clearApiCache = vi.fn();

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/stores/task-cache-store', () => ({
  useTaskCacheStore: (selector: (s: { updateTaskLocally: typeof updateTaskLocally }) => unknown) =>
    selector({ updateTaskLocally }),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('@/lib/api-client', () => ({
  clearApiCache: (path: string) => clearApiCache(path),
}));

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    labels: '[]',
    description: '',
    isProtected: false,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  }) as Task;

describe('useCompactTaskDetailActions', () => {
  const onTaskUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('patchTask', () => {
    it('成功時はキャッシュ更新・APIキャッシュクリア・親コールバックを呼ぶこと', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask();
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.patchTask({ title: 'New title' });
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/tasks/1',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New title' }),
        }),
      );
      expect(updateTaskLocally).toHaveBeenCalledWith(1, { title: 'New title' });
      expect(clearApiCache).toHaveBeenCalledWith('/tasks/1');
      expect(onTaskUpdated).toHaveBeenCalledTimes(1);
      expect(showToast).not.toHaveBeenCalled();
    });

    it('レスポンスがokでない場合はエラートーストを表示し、コールバックを呼ばないこと', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
      const task = createMockTask();
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.patchTask({ title: 'New title' });
      });

      expect(showToast).toHaveBeenCalledWith('saveFailed', 'error');
      expect(updateTaskLocally).not.toHaveBeenCalled();
      expect(onTaskUpdated).not.toHaveBeenCalled();
    });

    it('fetchが例外を投げた場合もエラートーストを表示すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      const task = createMockTask();
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.patchTask({ title: 'New title' });
      });

      expect(showToast).toHaveBeenCalledWith('saveFailed', 'error');
    });

    it('onTaskUpdatedが未指定でも例外を投げないこと', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask();
      const { result } = renderHook(() => useCompactTaskDetailActions({ task }));

      await expect(
        act(async () => {
          await result.current.patchTask({ title: 'x' });
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('saveField', () => {
    it('指定したフィールド名をキーにしてPATCHすること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask();
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.saveField('description', 'new description');
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ description: 'new description' }) }),
      );
    });
  });

  describe('toggleProtected', () => {
    it('isProtected=falseのタスクをtrueに反転すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ isProtected: false });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.toggleProtected();
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ isProtected: true }) }),
      );
    });

    it('isProtected=trueのタスクをfalseに反転すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ isProtected: true });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.toggleProtected();
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ isProtected: false }) }),
      );
    });
  });

  describe('insertLinkToDescription', () => {
    it('既存の説明がある場合は改行を挟んでリンクを追記すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ description: '既存の説明' });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.insertLinkToDescription('[link](http://example.com)');
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            description: '既存の説明\n[link](http://example.com)',
          }),
        }),
      );
    });

    it('説明が空の場合はリンクのみを設定すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ description: '' });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.insertLinkToDescription('[link](http://example.com)');
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ description: '[link](http://example.com)' }),
        }),
      );
    });

    it('説明が空白のみの場合もリンクのみを設定すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ description: '   ' });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.insertLinkToDescription('[link](http://example.com)');
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ description: '[link](http://example.com)' }),
        }),
      );
    });

    it('descriptionがnullの場合もリンクのみを設定すること', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const task = createMockTask({ description: null });
      const { result } = renderHook(() => useCompactTaskDetailActions({ task, onTaskUpdated }));

      await act(async () => {
        await result.current.insertLinkToDescription('[link](http://example.com)');
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ description: '[link](http://example.com)' }),
        }),
      );
    });
  });
});
