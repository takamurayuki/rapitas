/**
 * header/__tests__/use-header-search.test.ts
 *
 * Tests the header search's behaviour that the guidance text promises: typing
 * filters the current screen (debounced URL sync on /, /ideas and /kanban) and
 * Enter opens the all-items search page — and that IME confirmation does not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useHeader } from '../useHeader';

let mockPathname = '/';
let mockParams = new URLSearchParams();
const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: vi.fn(), forward: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useDarkMode', () => ({
  useDarkMode: () => ({ isDarkMode: false, mounted: true, toggleTheme: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false, logout: vi.fn() }),
}));

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/utils/tauri', () => ({ isTauri: () => false }));

/** A keydown the input would hand to handleSearchKeyDown. */
const keyDown = (key: string, isComposing = false) =>
  ({
    key,
    nativeEvent: { isComposing, keyCode: isComposing ? 229 : 13 },
    preventDefault: vi.fn(),
  }) as unknown as React.KeyboardEvent<HTMLInputElement>;

describe('useHeader search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPathname = '/';
    mockParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters the task list as you type (debounced ?search=)', () => {
    const { result } = renderHook(() => useHeader());
    act(() => result.current.setSearchQuery('  report '));
    expect(mockPush).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(mockPush).toHaveBeenCalledWith('/?search=report');
  });

  it('filters kanban columns in place (?q= via replace, no history entry)', () => {
    mockPathname = '/kanban';
    const { result } = renderHook(() => useHeader());
    act(() => result.current.setSearchQuery('bug'));
    act(() => vi.advanceTimersByTime(300));
    expect(mockReplace).toHaveBeenCalledWith('/kanban?q=bug', { scroll: false });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the all-items search page on Enter', () => {
    mockPathname = '/dashboard';
    const { result } = renderHook(() => useHeader());
    act(() => result.current.setSearchQuery('設計 メモ'));
    act(() => result.current.handleSearchKeyDown(keyDown('Enter')));
    expect(mockPush).toHaveBeenCalledWith(`/search?q=${encodeURIComponent('設計 メモ')}`);
  });

  it('does not navigate on the Enter that confirms IME input, nor on an empty query', () => {
    const { result } = renderHook(() => useHeader());
    act(() => result.current.setSearchQuery('せっけい'));
    act(() => result.current.handleSearchKeyDown(keyDown('Enter', true)));
    act(() => result.current.setSearchQuery('   '));
    act(() => result.current.handleSearchKeyDown(keyDown('Enter')));
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringMatching(/^\/search/));
  });
});
