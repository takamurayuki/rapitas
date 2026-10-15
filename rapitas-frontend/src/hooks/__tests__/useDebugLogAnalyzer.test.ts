import { renderHook, act } from '@testing-library/react';
import { useDebugLogAnalyzer } from '../feature/useDebugLogAnalyzer';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useDebugLogAnalyzer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyzeLog', () => {
    it('posts content and returns the parsed result with Date-converted timestamps', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            result: {
              entries: [{ message: 'a', timestamp: '2026-01-01T00:00:00.000Z' }],
              summary: {
                total: 1,
                timeRange: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z' },
              },
            },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useDebugLogAnalyzer());

      let analysis;
      await act(async () => {
        analysis = await result.current.analyzeLog('log content', 'json');
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3001/debug-logs/analyze',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(analysis!.entries[0].timestamp).toBeInstanceOf(Date);
      expect(analysis!.summary.timeRange!.start).toBeInstanceOf(Date);
      expect(result.current.isAnalyzing).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('returns null and sets error when the API reports failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ json: () => Promise.resolve({ success: false, error: 'bad log' }) }),
      );

      const { result } = renderHook(() => useDebugLogAnalyzer());
      let analysis;
      await act(async () => {
        analysis = await result.current.analyzeLog('bad');
      });

      expect(analysis).toBeNull();
      expect(result.current.error).toBe('bad log');
    });

    it('returns null and sets a generic error message on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

      const { result } = renderHook(() => useDebugLogAnalyzer());
      let analysis;
      await act(async () => {
        analysis = await result.current.analyzeLog('x');
      });

      expect(analysis).toBeNull();
      expect(result.current.error).toBe('down');
    });

    it('serializes filter start/end times to ISO strings when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            result: { entries: [], summary: { total: 0 } },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useDebugLogAnalyzer());
      const startTime = new Date('2026-01-01T00:00:00.000Z');
      await act(async () => {
        await result.current.analyzeLog('x', 'json', { filter: { startTime } });
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.options.filter.startTime).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('detectLogType', () => {
    it('returns the detected type on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ json: () => Promise.resolve({ success: true, type: 'nginx' }) }),
      );
      const { result } = renderHook(() => useDebugLogAnalyzer());

      let type;
      await act(async () => {
        type = await result.current.detectLogType('log');
      });
      expect(type).toBe('nginx');
    });

    it('falls back to "unknown" on error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      const { result } = renderHook(() => useDebugLogAnalyzer());

      let type;
      await act(async () => {
        type = await result.current.detectLogType('log');
      });
      expect(type).toBe('unknown');
    });
  });

  describe('getSupportedTypes', () => {
    it('returns the types array on success', async () => {
      const types = [{ id: 'nginx', name: 'Nginx', description: '', example: '' }];
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, types }) }),
      );
      const { result } = renderHook(() => useDebugLogAnalyzer());

      let types_;
      await act(async () => {
        types_ = await result.current.getSupportedTypes();
      });
      expect(types_).toEqual(types);
    });

    it('returns an empty array on error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      const { result } = renderHook(() => useDebugLogAnalyzer());

      let types_;
      await act(async () => {
        types_ = await result.current.getSupportedTypes();
      });
      expect(types_).toEqual([]);
    });
  });

  describe('analyzeFromUrl', () => {
    it('posts the url and returns a converted result', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            result: { entries: [], summary: { total: 0 } },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useDebugLogAnalyzer());
      let analysis;
      await act(async () => {
        analysis = await result.current.analyzeFromUrl('https://example.com/log.txt');
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3001/debug-logs/analyze-stream',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(analysis).not.toBeNull();
    });

    it('returns null on failure response', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ json: () => Promise.resolve({ success: false, error: 'nope' }) }),
      );
      const { result } = renderHook(() => useDebugLogAnalyzer());

      let analysis;
      await act(async () => {
        analysis = await result.current.analyzeFromUrl('https://example.com/log.txt');
      });
      expect(analysis).toBeNull();
      expect(result.current.error).toBe('nope');
    });
  });
});
