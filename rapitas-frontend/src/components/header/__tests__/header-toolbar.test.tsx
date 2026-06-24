/**
 * header/__tests__/header-toolbar.test.tsx
 *
 * Integration tests for the HeaderToolbar component.
 * Tests view toggle, user menu open/close, logout, more menu,
 * dark mode toggle, and restart button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderToolbar } from '../header-toolbar';

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

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _params?: Record<string, string>) => key,
}));

vi.mock('@/feature/tasks/pomodoro/GlobalPomodoroWidget', () => ({
  default: () => <div data-testid="pomodoro-widget" />,
}));

vi.mock('@/components/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell" />,
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

vi.mock('@/stores/task-detail-visibility-store', () => ({
  useTaskDetailVisibilityStore: (
    selector: (state: { isTaskDetailVisible: boolean }) => unknown,
  ) => selector({ isTaskDetailVisible: false }),
}));

vi.mock('@/utils/tauri', () => ({
  hideToTray: vi.fn(),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const createIcon = (testId: string) => {
    const Icon = ({ className }: { className?: string }) => (
      <div data-testid={testId} className={className} />
    );
    Icon.displayName = testId;
    return Icon;
  };
  const icons: Record<string, ReturnType<typeof createIcon>> = {
    Columns3: createIcon('columns3-icon'),
    List: createIcon('list-icon'),
    EllipsisVertical: createIcon('ellipsis-vertical-icon'),
    Moon: createIcon('moon-icon'),
    Sun: createIcon('sun-icon'),
    Settings: createIcon('settings-icon'),
    SquareArrowDown: createIcon('square-arrow-down-icon'),
    RotateCw: createIcon('rotate-cw-icon'),
    Loader2: createIcon('loader2-icon'),
    Sparkles: createIcon('sparkles-icon'),
    NotebookTabs: createIcon('notebook-tabs-icon'),
    User: createIcon('user-icon'),
    LogOut: createIcon('log-out-icon'),
  };
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = icons[key] ?? createIcon(`${key}-icon`);
  }
  return { ...mocked, ...icons };
});

const defaultProps = {
  hasMounted: true,
  isAuthLoading: false,
  isAuthenticated: true,
  user: {
    id: 1,
    username: 'TestUser',
    email: 'test@example.com',
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00Z',
    lastLoginAt: null,
  },
  isUserMenuOpen: false,
  setIsUserMenuOpen: vi.fn(),
  userMenuRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  handleLogout: vi.fn(),
  isMoreMenuOpen: false,
  setIsMoreMenuOpen: vi.fn(),
  moreMenuRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  modalState: { isOpen: false, activeTab: 'note' },
  openModal: vi.fn(),
  closeModal: vi.fn(),
  isDarkMode: false,
  darkModeMounted: true,
  toggleTheme: vi.fn(),
  isTauriEnv: false,
  isRestarting: false,
  handleRestartClick: vi.fn(),
};

describe('HeaderToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/';
  });

  describe('persistent elements', () => {
    it('renders the language switcher', () => {
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });

    it('renders the notification bell', () => {
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    });

    it('renders the pomodoro widget on non-task routes', () => {
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByTestId('pomodoro-widget')).toBeInTheDocument();
    });

    it('hides the pomodoro widget on /tasks/* routes', () => {
      mockPathname = '/tasks/123';
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.queryByTestId('pomodoro-widget')).not.toBeInTheDocument();
    });
  });

  describe('view toggle (list/kanban)', () => {
    it('shows List and Kanban buttons only on / route', () => {
      mockPathname = '/';
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByText('list')).toBeInTheDocument();
      expect(screen.getByText('kanban')).toBeInTheDocument();
    });

    it('shows List and Kanban buttons on /kanban route', () => {
      mockPathname = '/kanban';
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByText('list')).toBeInTheDocument();
      expect(screen.getByText('kanban')).toBeInTheDocument();
    });

    it('does not show view toggle on other routes', () => {
      mockPathname = '/dashboard';
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.queryByText('list')).not.toBeInTheDocument();
    });

    it('navigates to /kanban when clicking Kanban button from list view', () => {
      mockPathname = '/';
      render(<HeaderToolbar {...defaultProps} />);
      fireEvent.click(screen.getByText('kanban'));
      expect(mockPush).toHaveBeenCalledWith('/kanban');
    });

    it('navigates to / when clicking List button from kanban view', () => {
      mockPathname = '/kanban';
      render(<HeaderToolbar {...defaultProps} />);
      fireEvent.click(screen.getByText('list'));
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  describe('user menu', () => {
    it('renders the user menu button when authenticated', () => {
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'userMenu' })).toBeInTheDocument();
    });

    it('does not render user menu button when not authenticated', () => {
      render(<HeaderToolbar {...defaultProps} isAuthenticated={false} />);
      expect(screen.queryByRole('button', { name: 'userMenu' })).not.toBeInTheDocument();
    });

    it('does not render user menu button when hasMounted is false', () => {
      render(<HeaderToolbar {...defaultProps} hasMounted={false} />);
      expect(screen.queryByRole('button', { name: 'userMenu' })).not.toBeInTheDocument();
    });

    it('calls setIsUserMenuOpen when user menu button is clicked', () => {
      const setIsUserMenuOpen = vi.fn();
      render(<HeaderToolbar {...defaultProps} setIsUserMenuOpen={setIsUserMenuOpen} />);
      fireEvent.click(screen.getByRole('button', { name: 'userMenu' }));
      expect(setIsUserMenuOpen).toHaveBeenCalled();
    });

    it('shows username and email in dropdown when isUserMenuOpen=true', () => {
      render(<HeaderToolbar {...defaultProps} isUserMenuOpen={true} />);
      expect(screen.getByText('TestUser')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('calls handleLogout when logout button is clicked', () => {
      const handleLogout = vi.fn();
      render(<HeaderToolbar {...defaultProps} isUserMenuOpen={true} handleLogout={handleLogout} />);
      fireEvent.click(screen.getByText('logout'));
      expect(handleLogout).toHaveBeenCalled();
    });
  });

  describe('more menu', () => {
    it('renders the more menu button', () => {
      render(<HeaderToolbar {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'moreMenu' })).toBeInTheDocument();
    });

    it('calls setIsMoreMenuOpen when more menu button is clicked', () => {
      const setIsMoreMenuOpen = vi.fn();
      render(<HeaderToolbar {...defaultProps} setIsMoreMenuOpen={setIsMoreMenuOpen} />);
      fireEvent.click(screen.getByRole('button', { name: 'moreMenu' }));
      expect(setIsMoreMenuOpen).toHaveBeenCalled();
    });

    it('shows dark mode toggle in the more menu when open', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} />);
      expect(screen.getByText('switchToDark')).toBeInTheDocument();
    });

    it('calls toggleTheme when dark mode toggle is clicked', () => {
      const toggleTheme = vi.fn();
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} toggleTheme={toggleTheme} />);
      fireEvent.click(screen.getByText('switchToDark'));
      expect(toggleTheme).toHaveBeenCalled();
    });

    it('shows Moon icon in light mode', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} isDarkMode={false} />);
      expect(screen.getByTestId('moon-icon')).toBeInTheDocument();
    });

    it('shows Sun icon and switchToLight text in dark mode', () => {
      render(
        <HeaderToolbar {...defaultProps} isMoreMenuOpen={true} isDarkMode={true} darkModeMounted={true} />,
      );
      expect(screen.getByTestId('sun-icon')).toBeInTheDocument();
      expect(screen.getByText('switchToLight')).toBeInTheDocument();
    });

    it('shows settings link in the more menu', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} />);
      const settingsLink = screen.getByRole('link', { name: /generalSettings/i });
      expect(settingsLink).toHaveAttribute('href', '/settings/general');
    });

    it('calls handleRestartClick when restart button is clicked', () => {
      const handleRestartClick = vi.fn();
      render(
        <HeaderToolbar {...defaultProps} isMoreMenuOpen={true} handleRestartClick={handleRestartClick} />,
      );
      fireEvent.click(screen.getByText('restartServer'));
      expect(handleRestartClick).toHaveBeenCalled();
    });

    it('shows "restarting" text and disables restart button when isRestarting=true', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} isRestarting={true} />);
      expect(screen.getByText('restarting')).toBeInTheDocument();
      const button = screen.getByText('restarting').closest('button');
      expect(button).toBeDisabled();
    });

    it('does not show Tauri minimize button in non-Tauri environment', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} isTauriEnv={false} />);
      expect(screen.queryByText('minimizeToTray')).not.toBeInTheDocument();
    });

    it('shows Tauri minimize button in Tauri environment', () => {
      render(<HeaderToolbar {...defaultProps} isMoreMenuOpen={true} isTauriEnv={true} />);
      expect(screen.getByText('minimizeToTray')).toBeInTheDocument();
    });
  });
});
