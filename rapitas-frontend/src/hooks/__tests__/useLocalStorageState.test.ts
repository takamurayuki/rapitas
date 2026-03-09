import { renderHook, act } from '@testing-library/react';
import { useLocalStorageState } from '../useLocalStorageState';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('useLocalStorageState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return default value when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useLocalStorageState('testKey', 'default'),
    );
    expect(result.current[0]).toBe('default');
  });

  it('should read existing value from localStorage', () => {
    localStorage.setItem('testKey', JSON.stringify('stored'));
    const { result } = renderHook(() =>
      useLocalStorageState('testKey', 'default'),
    );
    expect(result.current[0]).toBe('stored');
  });

  it('should update state and localStorage on setValue', () => {
    const { result } = renderHook(() =>
      useLocalStorageState('testKey', 'default'),
    );

    act(() => {
      result.current[1]('newValue');
    });

    expect(result.current[0]).toBe('newValue');
    expect(JSON.parse(localStorage.getItem('testKey')!)).toBe('newValue');
  });

  it('should handle object values', () => {
    const { result } = renderHook(() =>
      useLocalStorageState('objKey', { count: 0 }),
    );

    act(() => {
      result.current[1]({ count: 5 });
    });

    expect(result.current[0]).toEqual({ count: 5 });
    expect(JSON.parse(localStorage.getItem('objKey')!)).toEqual({ count: 5 });
  });

  it('should remove item when setting null', () => {
    localStorage.setItem('testKey', JSON.stringify('value'));
    const { result } = renderHook(() =>
      useLocalStorageState<string | null>('testKey', 'default'),
    );

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem('testKey')).toBeNull();
  });

  it('should handle corrupted localStorage data', () => {
    localStorage.setItem('testKey', 'not-valid-json{{{');
    const { result } = renderHook(() =>
      useLocalStorageState('testKey', 'fallback'),
    );
    expect(result.current[0]).toBe('fallback');
  });

  it('should handle boolean values', () => {
    const { result } = renderHook(() =>
      useLocalStorageState('boolKey', false),
    );

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(JSON.parse(localStorage.getItem('boolKey')!)).toBe(true);
  });

  it('should handle array values', () => {
    const { result } = renderHook(() =>
      useLocalStorageState<number[]>('arrKey', []),
    );

    act(() => {
      result.current[1]([1, 2, 3]);
    });

    expect(result.current[0]).toEqual([1, 2, 3]);
  });
});
