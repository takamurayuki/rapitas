import { renderHook, act } from '@testing-library/react';
import { useWorkflowApproval } from '../workflow/useWorkflowApproval';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useWorkflowApproval', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, workflowStatus: 'plan_approved' }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useWorkflowApproval(1));
    expect(result.current.isApproving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should approve plan successfully', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useWorkflowApproval(1, onComplete));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.approvePlan(true);
    });

    expect(response!.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://test:3001/workflow/tasks/1/approve-plan',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, reason: undefined }),
      }),
    );
    expect(onComplete).toHaveBeenCalledWith('plan_approved');
    expect(result.current.isApproving).toBe(false);
  });

  it('should reject plan with reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, workflowStatus: 'plan_created' }),
      }),
    );

    const { result } = renderHook(() => useWorkflowApproval(1));

    await act(async () => {
      await result.current.approvePlan(false, 'Needs more detail');
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ approved: false, reason: 'Needs more detail' }),
      }),
    );
  });

  it('should handle HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad request' }),
      }),
    );

    const { result } = renderHook(() => useWorkflowApproval(1));

    let response: { success: boolean; error?: string };
    await act(async () => {
      response = await result.current.approvePlan(true);
    });

    expect(response!.success).toBe(false);
    expect(response!.error).toBe('Bad request');
    expect(result.current.error).toBe('Bad request');
  });

  it('should handle HTTP error with no JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('parse error')),
      }),
    );

    const { result } = renderHook(() => useWorkflowApproval(1));

    let response: { success: boolean; error?: string };
    await act(async () => {
      response = await result.current.approvePlan(true);
    });

    expect(response!.success).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
  });

  it('should handle network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network failure')),
    );

    const { result } = renderHook(() => useWorkflowApproval(1));

    let response: { success: boolean; error?: string };
    await act(async () => {
      response = await result.current.approvePlan(true);
    });

    expect(response!.success).toBe(false);
    expect(result.current.error).toBe('Network failure');
  });

  it('should not call onComplete when success is false in response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ success: false, workflowStatus: 'plan_created' }),
      }),
    );

    const onComplete = vi.fn();
    const { result } = renderHook(() => useWorkflowApproval(1, onComplete));

    await act(async () => {
      await result.current.approvePlan(true);
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('should clear error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));

    const { result } = renderHook(() => useWorkflowApproval(1));

    await act(async () => {
      await result.current.approvePlan(true);
    });

    expect(result.current.error).toBe('fail');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
