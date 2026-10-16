/**
 * header/__tests__/header-search.test.tsx
 *
 * Integration tests for the HeaderSearch component.
 * Tests search input rendering, clear button visibility,
 * and route-specific router calls on clear.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderSearch } from '../header-search';

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal, { Search: 'search-icon', X: 'x-icon' });
});

const makeDebounceRef = () => ({ current: null as NodeJS.Timeout | null });

describe('HeaderSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/';
  });

  it('renders the search input with placeholder from translation key', () => {
    render(
      <HeaderSearch
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    expect(screen.getByPlaceholderText('searchPlaceholder')).toBeInTheDocument();
  });

  it('renders the search icon', () => {
    render(
      <HeaderSearch
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
  });

  it('does not show clear button when search query is empty', () => {
    render(
      <HeaderSearch
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    expect(screen.queryByTestId('x-icon')).not.toBeInTheDocument();
  });

  it('shows clear button when search query is non-empty', () => {
    render(
      <HeaderSearch
        searchQuery="hello"
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
  });

  it('calls setSearchQuery with empty string on clear', () => {
    const setSearchQuery = vi.fn();
    render(
      <HeaderSearch
        searchQuery="hello"
        setSearchQuery={setSearchQuery}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.click(screen.getByTestId('x-icon').parentElement!);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });

  it('clears debounce timer on clear if one is pending', () => {
    const setSearchQuery = vi.fn();
    const timerId = setTimeout(() => {}, 10000);
    const debounceTimerRef = { current: timerId };
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    render(
      <HeaderSearch
        searchQuery="hello"
        setSearchQuery={setSearchQuery}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={debounceTimerRef}
      />,
    );
    fireEvent.click(screen.getByTestId('x-icon').parentElement!);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
    clearTimeout(timerId);
  });

  it('calls router.push("/search") on clear when on /search route', () => {
    mockPathname = '/search';
    render(
      <HeaderSearch
        searchQuery="query"
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.click(screen.getByTestId('x-icon').parentElement!);
    expect(mockPush).toHaveBeenCalledWith('/search');
  });

  it('calls router.replace("/kanban") on clear when on /kanban route', () => {
    mockPathname = '/kanban';
    render(
      <HeaderSearch
        searchQuery="query"
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.click(screen.getByTestId('x-icon').parentElement!);
    expect(mockReplace).toHaveBeenCalledWith('/kanban', { scroll: false });
  });

  it('calls router.push("/") on clear when on / route', () => {
    mockPathname = '/';
    render(
      <HeaderSearch
        searchQuery="query"
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.click(screen.getByTestId('x-icon').parentElement!);
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('calls handleSearchKeyDown on keydown in the input', () => {
    const handleSearchKeyDown = vi.fn();
    render(
      <HeaderSearch
        searchQuery="test"
        setSearchQuery={vi.fn()}
        handleSearchKeyDown={handleSearchKeyDown}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText('searchPlaceholder'), { key: 'Enter' });
    expect(handleSearchKeyDown).toHaveBeenCalled();
  });

  it('calls setSearchQuery when the input value changes', () => {
    const setSearchQuery = vi.fn();
    render(
      <HeaderSearch
        searchQuery=""
        setSearchQuery={setSearchQuery}
        handleSearchKeyDown={vi.fn()}
        debounceTimerRef={makeDebounceRef()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
      target: { value: 'new query' },
    });
    expect(setSearchQuery).toHaveBeenCalledWith('new query');
  });
});
