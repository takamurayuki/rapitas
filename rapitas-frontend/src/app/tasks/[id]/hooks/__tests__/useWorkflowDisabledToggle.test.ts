/**
 * useWorkflowDisabledToggle ユニットテスト
 *
 * task-level Task.workflowDisabled と global UserSettings.workflowDisabledGlobally
 * のOR判定、'todo'を離れたタスクでのロック、トグルAPI呼び出しの検証。
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkflowDisabledToggle } from '../useWorkflowDisabledToggle';
import type { Task } from '@/types';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    workflowDisabled: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as Task;
}

describe('useWorkflowDisabledToggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is false when neither the task-level nor global flag is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const setTask = vi.fn();
    const { result } = renderHook(() => useWorkflowDisabledToggle(1, makeTask(), setTask as never));

    await waitFor(() => expect(result.current.globallyForced).toBe(false));
    expect(result.current.effectiveWorkflowDisabled).toBe(false);
    expect(result.current.taskLevelWorkflowDisabled).toBe(false);
  });

  it('is true (globallyForced) when only the global setting is on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ workflowDisabledGlobally: true }),
      }),
    );
    const setTask = vi.fn();
    const { result } = renderHook(() => useWorkflowDisabledToggle(1, makeTask(), setTask as never));

    await waitFor(() => expect(result.current.globallyForced).toBe(true));
    expect(result.current.effectiveWorkflowDisabled).toBe(true);
    expect(result.current.taskLevelWorkflowDisabled).toBe(false);
  });

  it('is true when only the task-level flag is on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const setTask = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowDisabledToggle(1, makeTask({ workflowDisabled: true }), setTask as never),
    );

    await waitFor(() => expect(result.current.taskLevelWorkflowDisabled).toBe(true));
    expect(result.current.effectiveWorkflowDisabled).toBe(true);
  });

  it('is locked once the task has left todo status', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const setTask = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowDisabledToggle(1, makeTask({ status: 'in-progress' }), setTask as never),
    );

    expect(result.current.isLocked).toBe(true);
  });

  it('toggle() POSTs the flipped value and applies the response to task state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // GET /settings
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workflowDisabled: true }),
      }); // POST set-workflow-disabled
    vi.stubGlobal('fetch', fetchMock);
    const setTask = vi.fn();
    const { result } = renderHook(() => useWorkflowDisabledToggle(1, makeTask(), setTask as never));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.toggle();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://test:3001/workflow/tasks/1/set-workflow-disabled',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ disabled: true }),
      }),
    );
    expect(setTask).toHaveBeenCalled();
  });

  it('toggle() is a no-op when locked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const setTask = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowDisabledToggle(1, makeTask({ status: 'in-progress' }), setTask as never),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.toggle();
    });

    // Only the initial GET /settings — no POST attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTask).not.toHaveBeenCalled();
  });

  it('toggle() is a no-op without a taskId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const setTask = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowDisabledToggle(null, makeTask(), setTask as never),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.toggle();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTask).not.toHaveBeenCalled();
  });
});
