import { renderHook, act } from '@testing-library/react';
import { useDarkMode } from '../ui/useDarkMode';

describe('useDarkMode', () => {
  let mockClassList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockClassList = { add: vi.fn(), remove: vi.fn() };
    Object.defineProperty(document.documentElement, 'classList', {
      value: mockClassList,
      writable: true,
      configurable: true,
    });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return initial light theme before mounting', () => {
    const { result } = renderHook(() => useDarkMode());
    expect(result.current.theme).toBe('light');
    expect(result.current.isDarkMode).toBe(false);
    expect(result.current.mounted).toBe(false);
  });

  it('should read theme from localStorage after mount', () => {
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.isDarkMode).toBe(true);
    expect(result.current.mounted).toBe(true);
  });

  it('should use system preference when no localStorage value', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);

    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.theme).toBe('dark');
  });

  it('should default to light when no localStorage and no system dark preference', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.mounted).toBe(true);
  });

  it('should toggle theme', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.isDarkMode).toBe(true);

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.isDarkMode).toBe(false);
  });

  it('should set theme directly', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
  });

  it('should persist theme to localStorage when mounted', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('should update document classList when theme changes', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(mockClassList.add).toHaveBeenCalledWith('dark');
    expect(mockClassList.remove).toHaveBeenCalledWith('light');
  });
});
