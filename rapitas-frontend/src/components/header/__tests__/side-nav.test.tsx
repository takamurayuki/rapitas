/**
 * header/__tests__/side-nav.test.tsx
 *
 * Tests the side nav's footer: the signed-in user (icon + name) on the left,
 * the settings entry on the right, and that the old keyboard-shortcuts button
 * is gone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SideNav } from '../side-nav';
import type { User } from '@/contexts/AuthContext';
import { useSettingsModalStore } from '@/feature/settings/settings-modal-store';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

vi.mock('../nav-item', () => ({
  NavItemRenderer: () => null,
}));

const user: User = {
  id: 1,
  username: 'Yuki',
  email: 'yuki@example.com',
  role: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
};

const setIsMenuOpen = vi.fn();

const renderNav = (props: { user: User | null; isAuthLoading?: boolean; pinned?: boolean }) =>
  render(
    <SideNav
      menuRef={{ current: null }}
      isMenuOpen
      isMenuPinned={props.pinned ?? false}
      setIsMenuPinned={vi.fn()}
      setIsMenuOpen={setIsMenuOpen}
      filteredNavItems={[]}
      expandedItems={new Set()}
      toggleExpand={vi.fn()}
      user={props.user}
      isAuthLoading={props.isAuthLoading ?? false}
    />,
  );

describe('SideNav footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the user icon and name on the left, settings on the right', () => {
    renderNav({ user });
    const account = screen.getByTestId('side-nav-account');
    expect(within(account).getByTestId('User-icon')).toBeTruthy();
    expect(within(account).getByText('Yuki')).toBeTruthy();

    const settings = screen.getByRole('button', { name: 'settings' });
    // Same row, account first.
    expect(settings.parentElement).toBe(account.parentElement);
    expect(account.compareDocumentPosition(settings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows the icon and a not-signed-in label when signed out', () => {
    renderNav({ user: null });
    const account = screen.getByTestId('side-nav-account');
    expect(within(account).getByTestId('User-icon')).toBeTruthy();
    expect(within(account).getByText('notSignedIn')).toBeTruthy();
  });

  it('shows no label while the auth state is still loading', () => {
    renderNav({ user: null, isAuthLoading: true });
    expect(screen.queryByText('notSignedIn')).toBeNull();
  });

  it('closes the unpinned nav when settings is opened, keeps a pinned one', () => {
    renderNav({ user });
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);

    setIsMenuOpen.mockClear();
    renderNav({ user, pinned: true });
    fireEvent.click(screen.getAllByRole('button', { name: 'settings' })[1]);
    expect(setIsMenuOpen).not.toHaveBeenCalled();
  });

  it('opens the settings modal instead of navigating to a settings page', () => {
    useSettingsModalStore.setState({ isOpen: false, section: 'general' });
    renderNav({ user });
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(useSettingsModalStore.getState().isOpen).toBe(true);
  });

  it('no longer has the keyboard-shortcuts footer button', () => {
    renderNav({ user });
    expect(screen.queryByText('keyboardShortcuts')).toBeNull();
    expect(screen.queryByTestId('Keyboard-icon')).toBeNull();
  });
});
