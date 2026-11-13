/**
 * header/__tests__/side-nav.test.tsx
 *
 * Tests the side nav's footer: the signed-in user (icon + name) on the left,
 * the settings entry on the right, and that the old keyboard-shortcuts button
 * is gone. The account row is also the user menu's button (moved here from
 * the header), so its menu, keyboard handling and focus rules live here too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SideNav } from '../side-nav';
import type { User } from '@/contexts/AuthContext';

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
const handleLogout = vi.fn();

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
      handleLogout={handleLogout}
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

    const settings = screen.getByRole('link', { name: 'settings' });
    expect(settings.getAttribute('href')).toBe('/settings/general');
    // Same row, account first (the button sits in its menu's wrapper).
    expect(settings.parentElement).toBe(account.parentElement?.parentElement);
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
    fireEvent.click(screen.getByRole('link', { name: 'settings' }));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);

    setIsMenuOpen.mockClear();
    renderNav({ user, pinned: true });
    fireEvent.click(screen.getAllByRole('link', { name: 'settings' })[1]);
    expect(setIsMenuOpen).not.toHaveBeenCalled();
  });

  it('no longer has the keyboard-shortcuts footer button', () => {
    renderNav({ user });
    expect(screen.queryByText('keyboardShortcuts')).toBeNull();
    expect(screen.queryByTestId('Keyboard-icon')).toBeNull();
  });
});

describe('SideNav account menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const openMenu = () => {
    const button = screen.getByTestId('side-nav-account');
    fireEvent.click(button);
    return { button, menu: screen.getByRole('menu') };
  };

  it('is a menu button', () => {
    renderNav({ user });
    const button = screen.getByTestId('side-nav-account');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-label', 'userMenuTitle');
  });

  it('opens upwards with user info, profile and logout when signed in', () => {
    renderNav({ user });
    const { button, menu } = openMenu();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(menu.className).toContain('bottom-full');
    expect(within(menu).getByText('yuki@example.com')).toBeTruthy();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['rapiProfileLink', 'logout']);
    expect(items[0].getAttribute('href')).toBe('/settings/personal');
    // General settings stays on the footer's own button, not in the menu.
    expect(within(menu).queryByText('generalSettings')).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'settings' })).toBeNull();
  });

  it('offers profile, login and register when signed out', () => {
    renderNav({ user: null });
    const { menu } = openMenu();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['rapiProfileLink', 'login', 'register']);
    expect(items.map((i) => i.getAttribute('href'))).toEqual([
      '/settings/personal',
      '/auth/login',
      '/auth/register',
    ]);
    expect(within(menu).queryByText('logout')).toBeNull();
  });

  it('cannot be opened while auth is still loading', () => {
    renderNav({ user: null, isAuthLoading: true });
    const button = screen.getByTestId('side-nav-account');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('focuses the first item on open and moves with arrows, Home and End', () => {
    renderNav({ user: null });
    const { menu } = openMenu();
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    // Wraps from the last to the first, and from the first to the last.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Escape and returns focus to the account button', () => {
    renderNav({ user });
    const { button, menu } = openMenu();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on an outside click and returns focus to the account button', () => {
    renderNav({ user });
    const { button } = openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on Tab without pulling focus back', () => {
    renderNav({ user });
    const { menu } = openMenu();
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('logs out through the handler passed down from the header', () => {
    renderNav({ user });
    const { menu } = openMenu();
    fireEvent.click(within(menu).getByText('logout'));
    expect(handleLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes an unpinned nav when an item navigates, keeps a pinned one open', () => {
    renderNav({ user: null });
    let { menu } = openMenu();
    fireEvent.click(within(menu).getByText('login'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('menu')).toBeNull();

    setIsMenuOpen.mockClear();
    document.body.innerHTML = '';
    renderNav({ user: null, pinned: true });
    ({ menu } = openMenu());
    fireEvent.click(within(menu).getByText('login'));
    expect(setIsMenuOpen).not.toHaveBeenCalled();
  });
});
