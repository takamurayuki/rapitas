import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflowViewer } from './useWorkflowViewer';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));
vi.mock('@/hooks/workflow/useWorkflowFiles', () => ({
  useWorkflowFiles: () => ({
    files: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    workflowPath: null,
    workflowStatus: null,
  }),
}));

describe('useWorkflowViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects the question tab when workflowStatus is awaiting_question', async () => {
    const { result } = renderHook(() =>
      useWorkflowViewer({ taskId: 1, workflowStatus: 'awaiting_question' }),
    );

    await waitFor(() => expect(result.current.activeTab).toBe('question'));
  });

  it.each([
    ['research_done', 'research'],
    ['plan_created', 'plan'],
    ['in_progress', 'plan'],
    ['verify_done', 'verify'],
    ['completed', 'verify'],
  ] as const)('keeps selecting %s -> %s tab (regression)', async (workflowStatus, expectedTab) => {
    const { result } = renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus }));

    await waitFor(() => expect(result.current.activeTab).toBe(expectedTab));
  });

  it('leaves activeTab at the initial research tab for a status with no mapping (regression)', () => {
    const { result } = renderHook(() =>
      useWorkflowViewer({ taskId: 1, workflowStatus: 'blocked' }),
    );

    expect(result.current.activeTab).toBe('research');
  });
});
