import React from 'react';
import { renderToString } from 'react-dom/server';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorageState } from '../common/useLocalStorageState';

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
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('should read existing value from localStorage', () => {
    localStorage.setItem('testKey', JSON.stringify('stored'));
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));
    expect(result.current[0]).toBe('stored');
  });

  it('should update state and localStorage on setValue', () => {
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));

    act(() => {
      result.current[1]('newValue');
    });

    expect(result.current[0]).toBe('newValue');
    expect(JSON.parse(localStorage.getItem('testKey')!)).toBe('newValue');
  });

  it('should handle object values', () => {
    const { result } = renderHook(() => useLocalStorageState('objKey', { count: 0 }));

    act(() => {
      result.current[1]({ count: 5 });
    });

    expect(result.current[0]).toEqual({ count: 5 });
    expect(JSON.parse(localStorage.getItem('objKey')!)).toEqual({ count: 5 });
  });

  it('should remove item when setting null', () => {
    localStorage.setItem('testKey', JSON.stringify('value'));
    const { result } = renderHook(() => useLocalStorageState<string | null>('testKey', 'default'));

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem('testKey')).toBeNull();
  });

  it('should handle corrupted localStorage data', () => {
    localStorage.setItem('testKey', 'not-valid-json{{{');
    const { result } = renderHook(() => useLocalStorageState('testKey', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('should handle boolean values', () => {
    const { result } = renderHook(() => useLocalStorageState('boolKey', false));

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(JSON.parse(localStorage.getItem('boolKey')!)).toBe(true);
  });

  it('should handle array values', () => {
    const { result } = renderHook(() => useLocalStorageState<number[]>('arrKey', []));

    act(() => {
      result.current[1]([1, 2, 3]);
    });

    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('returns the default value without touching localStorage during SSR (window undefined)', () => {
    // Server-side rendering (via react-dom/server) never sees `window`. Use it
    // instead of renderHook (which requires `window` for React DOM/act) to
    // genuinely exercise the `typeof window === 'undefined'` branch.
    localStorage.setItem('ssrKey', JSON.stringify('should-not-be-read'));
    vi.stubGlobal('window', undefined);
    try {
      function TestComponent() {
        const [value] = useLocalStorageState('ssrKey', 'ssr-default');
        return React.createElement('div', null, String(value));
      }
      const html = renderToString(React.createElement(TestComponent));
      expect(html).toContain('ssr-default');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-reads an updated localStorage value via the deferred mount effect', () => {
    localStorage.setItem('testKey', JSON.stringify('initial'));
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));
    expect(result.current[0]).toBe('initial');

    // Simulate another tab/write landing between initial render and the
    // deferred mount-effect read (setTimeout(0)).
    localStorage.setItem('testKey', JSON.stringify('remounted'));

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current[0]).toBe('remounted');
  });

  it('logs and keeps the prior state when the deferred mount-effect read is corrupted', () => {
    localStorage.setItem('testKey', JSON.stringify('initial'));
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));
    expect(result.current[0]).toBe('initial');

    localStorage.setItem('testKey', 'not-valid-json{{{');

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current[0]).toBe('initial');
  });

  it('logs and does not throw when localStorage.setItem fails', () => {
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    try {
      act(() => {
        result.current[1]('newValue');
      });
      // State updates before the throwing localStorage write, so the UI
      // still reflects the new value even though persistence failed.
      expect(result.current[0]).toBe('newValue');
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('updates state when a matching storage event fires with a new value', () => {
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'testKey', newValue: JSON.stringify('fromOtherTab') }),
      );
    });

    expect(result.current[0]).toBe('fromOtherTab');
  });

  it('logs and ignores a storage event whose newValue is not valid JSON', () => {
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'testKey', newValue: 'not-valid-json{{{' }),
      );
    });

    expect(result.current[0]).toBe('default');
  });

  it('ignores a storage event for a different key', () => {
    const { result } = renderHook(() => useLocalStorageState('testKey', 'default'));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'otherKey', newValue: JSON.stringify('x') }),
      );
    });

    expect(result.current[0]).toBe('default');
  });
});
