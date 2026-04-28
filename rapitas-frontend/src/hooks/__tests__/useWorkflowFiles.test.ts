import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflowFiles } from '../workflow/useWorkflowFiles';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const mockFilesResponse = {
  research: {
    type: 'research',
    exists: true,
    content: '# Research',
    lastModified: '2026-01-01',
    size: 100,
  },
  question: { type: 'question', exists: false },
  plan: {
    type: 'plan',
    exists: true,
    content: '# Plan',
    lastModified: '2026-01-02',
    size: 200,
  },
  verify: { type: 'verify', exists: false },
  workflowStatus: 'plan_created',
  path: { taskId: 1, categoryId: 2, themeId: 3, dir: '/tasks/2/3/1' },
};

describe('useWorkflowFiles', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFilesResponse),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when taskId is null', () => {
    renderHook(() => useWorkflowFiles(null));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should fetch files when taskId is provided', async () => {
    const { result } = renderHook(() => useWorkflowFiles(1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledWith('http://test:3001/workflow/tasks/1/files');
    expect(result.current.files).toEqual({
      research: mockFilesResponse.research,
      question: mockFilesResponse.question,
      plan: mockFilesResponse.plan,
      verify: mockFilesResponse.verify,
    });
    expect(result.current.workflowStatus).toBe('plan_created');
    expect(result.current.workflowPath).toEqual(mockFilesResponse.path);
  });

  it('should set isLoading true on initial fetch', () => {
    const { result } = renderHook(() => useWorkflowFiles(1));
    expect(result.current.isLoading).toBe(true);
  });

  it('should compute hasAnyFile correctly when files exist', async () => {
    const { result } = renderHook(() => useWorkflowFiles(1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasAnyFile).toBe(true);
  });

  it('should compute hasAnyFile as false when no files exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            research: { type: 'research', exists: false },
            question: { type: 'question', exists: false },
            plan: { type: 'plan', exists: false },
            verify: { type: 'verify', exists: false },
            workflowStatus: 'draft',
          }),
      }),
    );

    const { result } = renderHook(() => useWorkflowFiles(1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasAnyFile).toBe(false);
  });

  it('should handle fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const { result } = renderHook(() => useWorkflowFiles(1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('HTTP 500');
    expect(result.current.files).toBeNull();
  });

  it('should handle network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useWorkflowFiles(1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('should reset state when taskId changes', async () => {
    const { result, rerender } = renderHook(({ taskId }) => useWorkflowFiles(taskId), {
      initialProps: { taskId: 1 as number | null },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.files).not.toBeNull();

    rerender({ taskId: 2 });

    // files should be reset immediately on taskId change
    // (they get set to null in the useEffect)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://test:3001/workflow/tasks/2/files');
    });
  });
});
