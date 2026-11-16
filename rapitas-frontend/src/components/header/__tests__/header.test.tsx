/**
 * header/__tests__/header.test.tsx
 *
 * Tests the Header's brand block per environment (the web build keeps the
 * Rapi+ wordmark home link, the desktop app (Tauri) renders no brand block)
 * and the back/forward pair that sits right of the menu button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../header';
import type { UseHeaderReturn } from '../useHeader';
import { useNavigationHistoryStore } from '../history';

let mockHeader: Partial<UseHeaderReturn>;

vi.mock('../useHeader', () => ({
  useHeader: () => mockHeader,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const mockBack = vi.fn();
const mockForward = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack, forward: mockForward }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../header-search', () => ({
  HeaderSearch: () => <div data-testid="header-search" />,
}));

vi.mock('../header-toolbar', () => ({
  HeaderToolbar: () => <div data-testid="header-toolbar" />,
}));

vi.mock('../side-nav', () => ({
  SideNav: () => <nav data-testid="side-nav" />,
}));

vi.mock('../restart-dialogs', () => ({
  RestartDialogs: () => null,
}));

function baseHeader(isTauriEnv: boolean): Partial<UseHeaderReturn> {
  return {
    hideHeader: false,
    showHeader: false,
    isTaskDetailPage: false,
    isMenuOpen: false,
    setIsMenuOpen: vi.fn(),
    getShortcutLabel: () => undefined,
    isTauriEnv,
    hasMounted: true,
  };
}

describe('Header brand block', () => {
  it('keeps the Rapi+ wordmark home link on the web', () => {
    mockHeader = baseHeader(false);
    render(<Header />);

    const brand = screen.getByTestId('header-brand');
    expect(brand.getAttribute('href')).toBe('/');
    expect(brand.textContent).toBe('Rapi+');
    // The first-paint CSS layer for the desktop app; inert on the web.
    expect(brand.className).toContain('tauri:hidden');
  });

  it('renders no brand block in the desktop app (Tauri)', () => {
    mockHeader = baseHeader(true);
    render(<Header />);

    expect(screen.queryByTestId('header-brand')).toBeNull();
    expect(screen.queryByText('Rapi+')).toBeNull();
    // Menu button, search and toolbar are still there.
    expect(screen.getByRole('button', { name: 'openMenu' })).toBeTruthy();
    expect(screen.getByTestId('header-search')).toBeTruthy();
    expect(screen.getByTestId('header-toolbar')).toBeTruthy();
  });
});

describe('Header back/forward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeader = baseHeader(false);
  });

  it('places back and forward right of the menu button, before the brand', () => {
    useNavigationHistoryStore.setState({ entries: ['/'], index: 0 });
    render(<Header />);

    const order = [
      screen.getByRole('button', { name: 'openMenu' }),
      screen.getByRole('button', { name: 'goBack' }),
      screen.getByRole('button', { name: 'goForward' }),
      screen.getByTestId('header-brand'),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('disables both buttons right after start (no history yet)', () => {
    useNavigationHistoryStore.setState({ entries: ['/'], index: 0 });
    render(<Header />);

    expect(screen.getByRole('button', { name: 'goBack' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'goForward' })).toBeDisabled();
  });

  it('enables only the side that has history and navigates with router.back/forward', () => {
    useNavigationHistoryStore.setState({ entries: ['/', '/dashboard', '/notes'], index: 1 });
    render(<Header />);

    const back = screen.getByRole('button', { name: 'goBack' });
    const forward = screen.getByRole('button', { name: 'goForward' });
    expect(back).toBeEnabled();
    expect(forward).toBeEnabled();
    fireEvent.click(back);
    fireEvent.click(forward);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockForward).toHaveBeenCalledTimes(1);
  });

  it('disables forward at the newest entry', () => {
    useNavigationHistoryStore.setState({ entries: ['/', '/dashboard'], index: 1 });
    render(<Header />);

    expect(screen.getByRole('button', { name: 'goBack' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'goForward' })).toBeDisabled();
  });

  it('renders no buttons when the header itself is hidden', () => {
    mockHeader = { ...baseHeader(false), hideHeader: true };
    render(<Header />);

    expect(screen.queryByRole('button', { name: 'goBack' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'goForward' })).toBeNull();
  });
});
