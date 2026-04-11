import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSearchFilters,
  type SearchFilter,
} from '../search/useSearchFilters';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeFilter = (overrides: Partial<SearchFilter> = {}): SearchFilter => ({
  id: 'test-1',
  type: 'status',
  label: 'Done',
  value: 'done',
  ...overrides,
});

describe('useSearchFilters', () => {
  it('starts with empty filters by default', () => {
    const { result } = renderHook(() => useSearchFilters());
    expect(result.current.filters).toEqual([]);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('starts with initial filters', () => {
    const initial = [makeFilter()];
    const { result } = renderHook(() => useSearchFilters(initial));
    expect(result.current.filters).toHaveLength(1);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('adds a filter', () => {
    const { result } = renderHook(() => useSearchFilters());

    act(() => {
      result.current.addFilter(makeFilter({ id: 'f1' }));
    });

    expect(result.current.filters).toHaveLength(1);
    expect(result.current.filters[0].id).toBe('f1');
  });

  it('replaces filter with same id', () => {
    const { result } = renderHook(() => useSearchFilters());

    act(() => {
      result.current.addFilter(makeFilter({ id: 'f1', value: 'old' }));
    });
    act(() => {
      result.current.addFilter(makeFilter({ id: 'f1', value: 'new' }));
    });

    expect(result.current.filters).toHaveLength(1);
    expect(result.current.filters[0].value).toBe('new');
  });

  it('removes a filter by id', () => {
    const { result } = renderHook(() =>
      useSearchFilters([makeFilter({ id: 'f1' }), makeFilter({ id: 'f2' })]),
    );

    act(() => {
      result.current.removeFilter('f1');
    });

    expect(result.current.filters).toHaveLength(1);
    expect(result.current.filters[0].id).toBe('f2');
  });

  it('clears all filters', () => {
    const { result } = renderHook(() =>
      useSearchFilters([makeFilter({ id: 'f1' }), makeFilter({ id: 'f2' })]),
    );

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.filters).toEqual([]);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('gets filters by type', () => {
    const { result } = renderHook(() =>
      useSearchFilters([
        makeFilter({ id: 'f1', type: 'status' }),
        makeFilter({ id: 'f2', type: 'priority' }),
        makeFilter({ id: 'f3', type: 'status' }),
      ]),
    );

    const statusFilters = result.current.getFiltersByType('status');
    expect(statusFilters).toHaveLength(2);
    expect(statusFilters.every((f) => f.type === 'status')).toBe(true);

    const priorityFilters = result.current.getFiltersByType('priority');
    expect(priorityFilters).toHaveLength(1);
  });
});
