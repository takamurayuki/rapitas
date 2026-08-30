import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkflowViewer } from './useWorkflowViewer';
import { setAppHidden } from '@/hooks/common/app-visibility-store';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockRefetch = vi.fn();
let mockWorkflowStatus: string | null = null;
vi.mock('@/hooks/workflow/useWorkflowFiles', () => ({
  useWorkflowFiles: () => ({
    files: null,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
    workflowPath: null,
    get workflowStatus() {
      return mockWorkflowStatus;
    },
  }),
}));

type SseHandler = (event: MessageEvent) => void;
type ConnectionListener = (connected: boolean) => void;

let sseConnected = true;
const subscribedHandlers: Record<string, Set<SseHandler>> = {};
const connectionListeners = new Set<ConnectionListener>();

const mockSubscribe = vi.fn((eventType: string, handler: SseHandler) => {
  (subscribedHandlers[eventType] ??= new Set()).add(handler);
  return () => subscribedHandlers[eventType]?.delete(handler);
});
const mockOnConnectionChange = vi.fn((listener: ConnectionListener) => {
  connectionListeners.add(listener);
  listener(sseConnected);
  return () => connectionListeners.delete(listener);
});
const mockIsConnected = vi.fn(() => sseConnected);

function emitSse(eventType: string, payload: unknown) {
  const set = subscribedHandlers[eventType];
  if (!set) return;
  const event = { data: JSON.stringify(payload) } as MessageEvent;
  for (const handler of set) handler(event);
}

function setSseConnected(connected: boolean) {
  sseConnected = connected;
  for (const listener of connectionListeners) listener(connected);
}

vi.mock('@/lib/sse/shared-event-source', () => ({
  sharedEventSource: {
    subscribe: (eventType: string, handler: SseHandler) => mockSubscribe(eventType, handler),
    onConnectionChange: (listener: ConnectionListener) => mockOnConnectionChange(listener),
    isConnected: () => mockIsConnected(),
  },
}));

describe('useWorkflowViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    mockWorkflowStatus = null;
    sseConnected = true;
    for (const key of Object.keys(subscribedHandlers)) delete subscribedHandlers[key];
    connectionListeners.clear();
    mockRefetch.mockClear();
    mockSubscribe.mockClear();
    mockOnConnectionChange.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    setAppHidden(false);
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

  describe('SSE駆動ポーリング（可視性連動フォールバック）', () => {
    it('ACTIVE状態でSSE接続中は phase_transition と item_update を購読する', () => {
      renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus: 'plan_created' }));

      expect(mockSubscribe).toHaveBeenCalledWith('phase_transition', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('item_update', expect.any(Function));
    });

    it('自タスクの phase_transition イベント受信で refetch がトリガーされる', () => {
      renderHook(() => useWorkflowViewer({ taskId: 42, workflowStatus: 'in_progress' }));
      mockRefetch.mockClear();

      act(() => {
        emitSse('phase_transition', { taskId: 42 });
      });

      expect(mockRefetch).toHaveBeenCalled();
    });

    it('他タスクのイベントは無視され refetch されない', () => {
      renderHook(() => useWorkflowViewer({ taskId: 42, workflowStatus: 'in_progress' }));
      mockRefetch.mockClear();

      act(() => {
        emitSse('item_update', { taskId: 999 });
      });

      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('SSE切断かつ画面表示中のみ3秒フォールバックポーリングが起動する', () => {
      vi.useFakeTimers();
      renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus: 'in_progress' }));
      mockRefetch.mockClear();

      act(() => {
        setSseConnected(false);
      });
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockRefetch).toHaveBeenCalled();
    });

    it('document.hidden=true では SSE切断でもフォールバックポーリングが起動しない', () => {
      vi.useFakeTimers();
      renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus: 'in_progress' }));
      mockRefetch.mockClear();

      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => {
        setSseConnected(false);
      });
      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('getAppHidden()=true（最小化）では SSE切断でもフォールバックポーリングが起動しない', () => {
      vi.useFakeTimers();
      renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus: 'in_progress' }));
      mockRefetch.mockClear();

      setAppHidden(true);
      act(() => {
        setSseConnected(false);
      });
      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('SSEが再接続するとフォールバックポーリングは停止する', () => {
      vi.useFakeTimers();
      renderHook(() => useWorkflowViewer({ taskId: 1, workflowStatus: 'in_progress' }));

      act(() => {
        setSseConnected(false);
      });
      act(() => {
        setSseConnected(true);
      });
      mockRefetch.mockClear();

      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('plan_approved のとき isPolling===true である（次フェーズボタンの誤出現防止・回帰テスト）', () => {
      const { result } = renderHook(() =>
        useWorkflowViewer({ taskId: 1, workflowStatus: 'plan_approved' }),
      );

      expect(result.current.isPolling).toBe(true);
    });

    it('終端状態（completed）では isPolling===false かつ購読しない', () => {
      const { result } = renderHook(() =>
        useWorkflowViewer({ taskId: 1, workflowStatus: 'completed' }),
      );

      expect(result.current.isPolling).toBe(false);
    });
  });
});
