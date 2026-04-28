vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
  clearApiCache: vi.fn(),
}));

import { useFilterDataStore } from '../filter-data-store';
import { apiFetch, clearApiCache } from '@/lib/api-client';

describe('filterDataStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFilterDataStore.setState({
      categories: [],
      themes: [],
      lastUpdated: null,
      isInitialized: false,
      isLoading: false,
      error: null,
      cacheExpireTime: 60 * 60 * 1000,
    });
  });

  it('should have correct initial state', () => {
    const state = useFilterDataStore.getState();
    expect(state.categories).toEqual([]);
    expect(state.themes).toEqual([]);
    expect(state.lastUpdated).toBeNull();
    expect(state.isInitialized).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('setCategories', () => {
    it('should set categories', () => {
      const categories = [{ id: 1, name: 'Test' }] as never[];
      useFilterDataStore.getState().setCategories(categories);
      expect(useFilterDataStore.getState().categories).toEqual(categories);
    });
  });

  describe('setThemes', () => {
    it('should set themes', () => {
      const themes = [{ id: 1, name: 'Theme1' }] as never[];
      useFilterDataStore.getState().setThemes(themes);
      expect(useFilterDataStore.getState().themes).toEqual(themes);
    });
  });

  describe('clearCache', () => {
    it('should reset all data to initial state', () => {
      useFilterDataStore.setState({
        categories: [{ id: 1, name: 'Cat' }] as never[],
        themes: [{ id: 1, name: 'Theme' }] as never[],
        lastUpdated: Date.now(),
        isInitialized: true,
        error: 'some error',
      });
      useFilterDataStore.getState().clearCache();
      const state = useFilterDataStore.getState();
      expect(state.categories).toEqual([]);
      expect(state.themes).toEqual([]);
      expect(state.lastUpdated).toBeNull();
      expect(state.isInitialized).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('isDataFresh', () => {
    it('should return false when lastUpdated is null', () => {
      expect(useFilterDataStore.getState().isDataFresh()).toBe(false);
    });

    it('should return true when data is within cache expiry', () => {
      useFilterDataStore.setState({ lastUpdated: Date.now() });
      expect(useFilterDataStore.getState().isDataFresh()).toBe(true);
    });

    it('should return false when data is expired', () => {
      useFilterDataStore.setState({
        lastUpdated: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      });
      expect(useFilterDataStore.getState().isDataFresh()).toBe(false);
    });
  });

  describe('shouldBackgroundRefresh', () => {
    it('should return false when lastUpdated is null', () => {
      expect(useFilterDataStore.getState().shouldBackgroundRefresh()).toBe(false);
    });

    it('should return false when isLoading is true', () => {
      useFilterDataStore.setState({
        lastUpdated: Date.now() - 50 * 60 * 1000,
        isLoading: true,
      });
      expect(useFilterDataStore.getState().shouldBackgroundRefresh()).toBe(false);
    });

    it('should return true when age exceeds 80% of cache time', () => {
      // 80% of 1 hour = 48 minutes
      useFilterDataStore.setState({ lastUpdated: Date.now() - 50 * 60 * 1000 });
      expect(useFilterDataStore.getState().shouldBackgroundRefresh()).toBe(true);
    });

    it('should return false when age is below 80% of cache time', () => {
      useFilterDataStore.setState({ lastUpdated: Date.now() - 10 * 60 * 1000 });
      expect(useFilterDataStore.getState().shouldBackgroundRefresh()).toBe(false);
    });
  });

  describe('setError / clearError', () => {
    it('should set error message', () => {
      useFilterDataStore.getState().setError('test error');
      expect(useFilterDataStore.getState().error).toBe('test error');
    });

    it('should clear error', () => {
      useFilterDataStore.getState().setError('test error');
      useFilterDataStore.getState().clearError();
      expect(useFilterDataStore.getState().error).toBeNull();
    });
  });

  describe('initializeData', () => {
    it('should skip if already initialized and data is fresh', async () => {
      useFilterDataStore.setState({
        isInitialized: true,
        lastUpdated: Date.now(),
        categories: [{ id: 1 }] as never[],
      });
      await useFilterDataStore.getState().initializeData();
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should fetch categories and themes on initialization', async () => {
      const mockCategories = [{ id: 1, name: 'Cat1' }];
      const mockThemes = [{ id: 1, name: 'Theme1' }];
      vi.mocked(apiFetch).mockResolvedValueOnce(mockCategories).mockResolvedValueOnce(mockThemes);

      await useFilterDataStore.getState().initializeData();

      const state = useFilterDataStore.getState();
      expect(state.categories).toEqual(mockCategories);
      expect(state.themes).toEqual(mockThemes);
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdated).not.toBeNull();
    });

    it('should set error when fetch fails', async () => {
      vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));

      await useFilterDataStore.getState().initializeData();

      const state = useFilterDataStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toContain('Failed to load filter data');
    });
  });

  describe('refreshData', () => {
    it('should skip refresh when data is fresh and not forced', async () => {
      useFilterDataStore.setState({
        isInitialized: true,
        lastUpdated: Date.now(),
      });
      await useFilterDataStore.getState().refreshData(false);
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should clear api cache and re-initialize when forced', async () => {
      const mockCategories = [{ id: 1, name: 'Cat1' }];
      const mockThemes = [{ id: 1, name: 'Theme1' }];
      vi.mocked(apiFetch).mockResolvedValueOnce(mockCategories).mockResolvedValueOnce(mockThemes);

      useFilterDataStore.setState({
        isInitialized: true,
        lastUpdated: Date.now(),
      });

      await useFilterDataStore.getState().refreshData(true);

      expect(clearApiCache).toHaveBeenCalledWith('/categories');
      expect(clearApiCache).toHaveBeenCalledWith('/themes');
      expect(apiFetch).toHaveBeenCalled();
    });
  });
});
