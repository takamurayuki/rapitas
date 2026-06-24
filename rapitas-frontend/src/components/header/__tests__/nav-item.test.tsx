/**
 * header/__tests__/nav-item.test.tsx
 *
 * Integration tests for the NavItemRenderer component.
 * Tests expand/collapse behavior, link rendering, active states,
 * and correct invocation of setIsMenuOpen on navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavItemRenderer } from '../nav-item';
import type { NavItem } from '../types';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: ({ className }: { className?: string }) => (
    <div data-testid="chevron-down" className={className} />
  ),
  ChevronRight: ({ className }: { className?: string }) => (
    <div data-testid="chevron-right" className={className} />
  ),
}));

const TestIcon = ({ className }: { className?: string }) => (
  <div data-testid="nav-icon" className={className} />
);

const leafItem: NavItem = {
  href: '/dashboard',
  label: 'ダッシュボード',
  icon: TestIcon,
};

const parentItemNoLink: NavItem = {
  href: '#',
  label: 'グループ',
  icon: TestIcon,
  children: [
    { href: '/child1', label: 'Child 1', icon: TestIcon },
    { href: '/child2', label: 'Child 2', icon: TestIcon },
  ],
};

const parentItemWithLink: NavItem = {
  href: '/parent',
  label: 'Parent',
  icon: TestIcon,
  children: [{ href: '/child1', label: 'Child 1', icon: TestIcon }],
};

const itemWithShortcut: NavItem = {
  href: '/tasks',
  label: 'タスク',
  icon: TestIcon,
  shortcut: 'Ctrl+T',
};

const baseProps = {
  depth: 0,
  isActive: vi.fn((_href: string) => false),
  isChildActive: vi.fn((_item: NavItem) => false),
  expandedItems: new Set<string>(),
  toggleExpand: vi.fn(),
  isMenuPinned: false,
  setIsMenuOpen: vi.fn(),
};

describe('NavItemRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('depth=0 leaf item (no children)', () => {
    it('renders a link with the correct href', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} />);
      const link = screen.getByRole('link', { name: /ダッシュボード/i });
      expect(link).toHaveAttribute('href', '/dashboard');
    });

    it('renders the label text', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} />);
      expect(screen.getByText('ダッシュボード')).toBeInTheDocument();
    });

    it('renders the icon', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} />);
      expect(screen.getByTestId('nav-icon')).toBeInTheDocument();
    });

    it('calls setIsMenuOpen(false) on link click when not pinned', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} isMenuPinned={false} />);
      fireEvent.click(screen.getByRole('link', { name: /ダッシュボード/i }));
      expect(baseProps.setIsMenuOpen).toHaveBeenCalledWith(false);
    });

    it('does NOT call setIsMenuOpen when menu is pinned', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} isMenuPinned={true} />);
      fireEvent.click(screen.getByRole('link', { name: /ダッシュボード/i }));
      expect(baseProps.setIsMenuOpen).not.toHaveBeenCalled();
    });

    it('renders shortcut label when item has shortcut', () => {
      render(<NavItemRenderer {...baseProps} item={itemWithShortcut} />);
      expect(screen.getByText('Ctrl+T')).toBeInTheDocument();
    });

    it('applies active styles when isActive returns true', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} isActive={() => true} />);
      const link = screen.getByRole('link', { name: /ダッシュボード/i });
      // Active item has indigo background class
      expect(link.className).toContain('bg-indigo-100');
    });
  });

  describe('depth=0 parent item (href="#", children only)', () => {
    it('renders a button instead of a link', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemNoLink} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('shows ChevronRight when collapsed', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemNoLink} />);
      expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
    });

    it('calls toggleExpand with the item label on button click', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemNoLink} />);
      fireEvent.click(screen.getByRole('button'));
      expect(baseProps.toggleExpand).toHaveBeenCalledWith('グループ');
    });

    it('renders children when expandedItems contains the label', () => {
      render(
        <NavItemRenderer
          {...baseProps}
          item={parentItemNoLink}
          expandedItems={new Set(['グループ'])}
        />,
      );
      expect(screen.getByText('Child 1')).toBeInTheDocument();
      expect(screen.getByText('Child 2')).toBeInTheDocument();
    });

    it('does not render children when collapsed', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemNoLink} />);
      expect(screen.queryByText('Child 1')).not.toBeInTheDocument();
    });

    it('shows ChevronDown when expanded', () => {
      render(
        <NavItemRenderer
          {...baseProps}
          item={parentItemNoLink}
          expandedItems={new Set(['グループ'])}
        />,
      );
      // The expand button should show chevron-down when expanded
      expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    });
  });

  describe('depth=0 parent item with valid href', () => {
    it('renders both a link and an expand toggle button', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemWithLink} />);
      expect(screen.getByRole('link', { name: /Parent/i })).toBeInTheDocument();
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('link href points to the parent route', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemWithLink} />);
      expect(screen.getByRole('link', { name: /Parent/i })).toHaveAttribute('href', '/parent');
    });

    it('expand toggle button calls toggleExpand', () => {
      render(<NavItemRenderer {...baseProps} item={parentItemWithLink} />);
      fireEvent.click(screen.getByRole('button'));
      expect(baseProps.toggleExpand).toHaveBeenCalledWith('Parent');
    });
  });

  describe('depth>0 leaf item', () => {
    it('renders a link at nested depth', () => {
      render(<NavItemRenderer {...baseProps} item={leafItem} depth={1} parentExpanded={true} />);
      expect(screen.getByRole('link', { name: /ダッシュボード/i })).toBeInTheDocument();
    });

    it('calls setIsMenuOpen(false) on click when not pinned', () => {
      render(
        <NavItemRenderer
          {...baseProps}
          item={leafItem}
          depth={1}
          parentExpanded={true}
          isMenuPinned={false}
        />,
      );
      fireEvent.click(screen.getByRole('link', { name: /ダッシュボード/i }));
      expect(baseProps.setIsMenuOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('depth>0 parent item (href="#")', () => {
    it('renders expand button for nested parent with no link', () => {
      render(
        <NavItemRenderer {...baseProps} item={parentItemNoLink} depth={1} parentExpanded={true} />,
      );
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders children when expanded', () => {
      render(
        <NavItemRenderer
          {...baseProps}
          item={parentItemNoLink}
          depth={1}
          parentExpanded={true}
          expandedItems={new Set(['グループ'])}
        />,
      );
      expect(screen.getByText('Child 1')).toBeInTheDocument();
    });
  });
});
