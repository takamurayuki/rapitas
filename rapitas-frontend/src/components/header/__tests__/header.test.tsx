/**
 * header/__tests__/header.test.tsx
 *
 * Tests the Header's brand block per environment: the web build keeps the
 * Rapi+ wordmark (home link), the desktop app (Tauri) renders no brand block
 * and packs the remaining items to the left.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from '../header';
import type { UseHeaderReturn } from '../useHeader';

let mockHeader: Partial<UseHeaderReturn>;
const toolbarClassNames: Array<string | undefined> = [];

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

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../header-search', () => ({
  HeaderSearch: () => <div data-testid="header-search" />,
}));

vi.mock('../header-toolbar', () => ({
  HeaderToolbar: ({ className }: { className?: string }) => {
    toolbarClassNames.push(className);
    return <div data-testid="header-toolbar" className={className} />;
  },
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
  beforeEach(() => {
    toolbarClassNames.length = 0;
  });

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

  it('packs the remaining items left in the desktop app via the toolbar auto margin', () => {
    mockHeader = baseHeader(true);
    render(<Header />);

    expect(toolbarClassNames.at(-1)).toBe('tauri:ml-auto');
  });
});
