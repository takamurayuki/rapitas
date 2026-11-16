/**
 * header/__tests__/header-search-guidance.test.tsx
 *
 * Tests what the header search shows about its own behaviour: the Enter hint
 * while typing (beside, not instead of, the clear button), the shortcut badge
 * while empty, and the focusSearch shortcut (⌘K / Ctrl+K) moving focus into it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HeaderSearch, formatSearchShortcut } from '../header-search';
import { useShortcutStore, DEFAULT_SHORTCUTS } from '@/stores/shortcut-store';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const renderSearch = (searchQuery: string) =>
  render(
    <HeaderSearch
      searchQuery={searchQuery}
      setSearchQuery={vi.fn()}
      handleSearchKeyDown={vi.fn()}
      debounceTimerRef={{ current: null }}
    />,
  );

const setPlatform = (value: string) =>
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });

describe('HeaderSearch guidance', () => {
  beforeEach(() => {
    useShortcutStore.getState().resetAll();
    setPlatform('Win32');
  });

  afterEach(() => {
    setPlatform('');
  });

  it('shows the Enter hint next to the clear button while typing', () => {
    renderSearch('invoice');
    const hint = screen.getByTestId('search-enter-hint');
    expect(hint.textContent).toBe('searchEnterHint');
    const clear = screen.getByRole('button', { name: 'clearSearch' });
    // Both live in the same right-hand row, hint first — so they never overlap.
    expect(hint.parentElement).toBe(clear.parentElement);
    expect(hint.compareDocumentPosition(clear)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByTestId('search-shortcut-badge')).toBeNull();
  });

  it('shows the shortcut badge (not the hint) while empty', () => {
    renderSearch('');
    expect(screen.getByTestId('search-shortcut-badge').textContent).toBe('Ctrl+K');
    expect(screen.queryByTestId('search-enter-hint')).toBeNull();
  });

  it('writes the badge the macOS way on a Mac', () => {
    setPlatform('MacIntel');
    renderSearch('');
    expect(screen.getByTestId('search-shortcut-badge').textContent).toBe('⌘K');
  });

  it.each([
    ['Ctrl+K', { ctrlKey: true }],
    ['⌘K', { metaKey: true }],
  ])('focuses the input on %s', (_label, mods) => {
    renderSearch('');
    const input = screen.getByPlaceholderText('searchPlaceholder');
    expect(document.activeElement).not.toBe(input);
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ...mods });
    });
    expect(document.activeElement).toBe(input);
  });

  it('ignores K without a modifier and ⌘⇧K (the kanban shortcut)', () => {
    renderSearch('');
    const input = screen.getByPlaceholderText('searchPlaceholder');
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'K', metaKey: true, shiftKey: true });
    expect(document.activeElement).not.toBe(input);
  });

  it('follows a rebinding in the shortcut settings', () => {
    useShortcutStore.getState().updateShortcut('focusSearch', { key: 'J' });
    renderSearch('');
    expect(screen.getByTestId('search-shortcut-badge').textContent).toBe('Ctrl+J');
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByPlaceholderText('searchPlaceholder'));
  });

  it('formats the default binding per platform', () => {
    const binding = DEFAULT_SHORTCUTS.find((s) => s.id === 'focusSearch');
    expect(binding).toBeDefined();
    expect(formatSearchShortcut(binding!, true)).toBe('⌘K');
    expect(formatSearchShortcut(binding!, false)).toBe('Ctrl+K');
  });
});
