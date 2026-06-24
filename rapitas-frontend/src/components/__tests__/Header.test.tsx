import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../common/Header';

// Mock Next.js hooks
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock contexts and stores
const mockLogout = vi.fn();
const mockToggleTheme = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'TestUser', email: 'test@example.com', role: 'user' },
    isAuthenticated: true,
    isLoading: false,
    logout: mockLogout,
  }),
}));

vi.mock('@/hooks/useDarkMode', () => ({
  useDarkMode: () => ({
    isDarkMode: false,
    mounted: true,
    toggleTheme: mockToggleTheme,
  }),
}));

vi.mock('@/stores/shortcutStore', () => ({
  useShortcutStore: (selector: (state: { shortcuts: [] }) => unknown) =>
    selector({ shortcuts: [] }),
}));

vi.mock('@/stores/app-mode-store', () => ({
  useAppModeStore: (selector: (state: { mode: string }) => unknown) => selector({ mode: 'normal' }),
}));

vi.mock('@/stores/note-store', () => ({
  useNoteStore: () => ({
    modalState: { isOpen: false, activeTab: 'note' },
    openModal: vi.fn(),
    closeModal: vi.fn(),
  }),
}));

// Mock internationalization - return the key as-is
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _params?: Record<string, string>) => key,
}));

// Mock components
vi.mock('@/components/app-icon', () => ({
  default: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="app-icon" />
  ),
}));

vi.mock('@/feature/tasks/pomodoro/GlobalPomodoroWidget', () => ({
  default: () => <div data-testid="pomodoro-widget" />,
}));

vi.mock('@/components/KeyboardShortcuts', () => ({
  OPEN_SHORTCUTS_EVENT: 'open-shortcuts',
}));

vi.mock('@/components/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell" />,
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

// Mock Tauri utilities
vi.mock('@/utils/tauri', () => ({
  isTauri: () => false,
  hideToTray: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

// NOTE: Uses the shared self-repairing factory. Newly-imported icons are
// auto-stubbed; only icons whose test-ids are asserted below need overrides.
vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal, {
    Menu: 'menu-icon',
    Home: 'home-icon',
    Columns3: 'columns3-icon',
    List: 'list-icon',
    Tags: 'tags-icon',
    SwatchBook: 'swatchbook-icon',
    Search: 'search-icon',
    X: 'x-icon',
    LayoutDashboard: 'layout-dashboard-icon',
    LayoutList: 'layout-list-icon',
    Folders: 'folders-icon',
    FolderKanban: 'folder-kanban-icon',
    ChevronDown: 'chevron-down-icon',
    ChevronRight: 'chevron-right-icon',
    Target: 'target-icon',
    BarChart3: 'bar-chart3-icon',
    Trophy: 'trophy-icon',
    CalendarRange: 'calendar-range-icon',
    Brain: 'brain-icon',
    FileText: 'file-text-icon',
    Calendar: 'calendar-icon',
    Clock: 'clock-icon',
    GraduationCap: 'graduation-cap-icon',
    Keyboard: 'keyboard-icon',
    Bot: 'bot-icon',
    CheckCircle: 'check-circle-icon',
    Settings: 'settings-icon',
    GitPullRequest: 'git-pull-request-icon',
    CircleDot: 'circle-dot-icon',
    Code: 'code-icon',
    Key: 'key-icon',
    Pin: 'pin-icon',
    PinOff: 'pin-off-icon',
    MessageSquare: 'message-square-icon',
    SquareArrowDown: 'square-arrow-down-icon',
    EllipsisVertical: 'ellipsis-vertical-icon',
    Moon: 'moon-icon',
    Sun: 'sun-icon',
    BookMarked: 'book-marked-icon',
    RotateCw: 'rotate-cw-icon',
    Loader2: 'loader2-icon',
    Sparkles: 'sparkles-icon',
    NotebookTabs: 'notebook-tabs-icon',
    User: 'user-icon',
    LogOut: 'log-out-icon',
    Package: 'package-icon',
    Lightbulb: 'lightbulb-icon',
  });
});

// Mock window.dispatchEvent
Object.defineProperty(window, 'dispatchEvent', {
  value: vi.fn(),
  writable: true,
});

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('renders the header', () => {
      render(<Header />);
      const header = screen.getByRole('banner');
      expect(header).toBeInTheDocument();
    });

    it('renders the app icon', () => {
      render(<Header />);
      // AppIcon appears in both header and sidebar nav
      const icons = screen.getAllByTestId('app-icon');
      expect(icons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the menu button', () => {
      render(<Header />);
      // aria-label is t('openMenu') which returns 'openMenu'
      const menuButton = screen.getByRole('button', { name: /openMenu/i });
      expect(menuButton).toBeInTheDocument();
    });

    it('always renders the search bar', () => {
      render(<Header />);
      const searchInput = screen.getByPlaceholderText('searchPlaceholder');
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe('Navigation menu', () => {
    it('opens navigation on menu button click', async () => {
      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });
      fireEvent.click(menuButton);

      await waitFor(() => {
        expect(screen.getByRole('navigation')).toBeInTheDocument();
      });
    });

    it('contains primary navigation links', async () => {
      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });
      fireEvent.click(menuButton);

      await waitFor(() => {
        // Translation keys are returned as-is: t('taskList'), t('dashboard'), etc.
        expect(screen.getByText('taskList')).toBeInTheDocument();
      });
    });

    it('closes menu on second click', async () => {
      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });

      fireEvent.click(menuButton);
      await waitFor(() => {
        // The sidebar nav should have translate-x-0 class when open
        const nav = screen.getByRole('navigation');
        expect(nav).toBeInTheDocument();
        expect(nav.className).toContain('translate-x-0');
      });

      fireEvent.click(menuButton);
      await waitFor(() => {
        const nav = screen.getByRole('navigation');
        expect(nav.className).toContain('-translate-x-full');
      });
    });
  });

  describe('Search functionality', () => {
    it('renders the search input field', () => {
      render(<Header />);
      const searchInput = screen.getByPlaceholderText('searchPlaceholder');
      expect(searchInput).toBeInTheDocument();
    });

    it('accepts search query input', () => {
      render(<Header />);
      const searchInput = screen.getByPlaceholderText('searchPlaceholder') as HTMLInputElement;
      fireEvent.change(searchInput, { target: { value: 'test query' } });
      expect(searchInput).toHaveValue('test query');
    });
  });

  describe('Dark mode toggle', () => {
    it('dark mode button in more menu is clickable', async () => {
      render(<Header />);
      // Dark mode toggle is inside the more menu (EllipsisVertical button)
      const moreMenuButton = screen.getByRole('button', { name: /moreMenu/i });
      fireEvent.click(moreMenuButton);

      await waitFor(() => {
        // The dark mode button text is t('switchToDark') = 'switchToDark'
        const darkModeButton = screen.getByText('switchToDark');
        fireEvent.click(darkModeButton);
        expect(mockToggleTheme).toHaveBeenCalled();
      });
    });

    it('displays appropriate icon based on dark mode state', async () => {
      render(<Header />);
      // Open more menu
      const moreMenuButton = screen.getByRole('button', { name: /moreMenu/i });
      fireEvent.click(moreMenuButton);

      await waitFor(() => {
        // In light mode (isDarkMode: false), shows Moon icon and "switchToDark" text
        expect(screen.getByTestId('moon-icon')).toBeInTheDocument();
        expect(screen.getByText('switchToDark')).toBeInTheDocument();
      });
    });
  });

  describe('Integrated components', () => {
    it('renders the pomodoro widget', () => {
      render(<Header />);
      expect(screen.getByTestId('pomodoro-widget')).toBeInTheDocument();
    });

    it('renders the notification bell', () => {
      render(<Header />);
      expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    });

    it('renders the language switcher', () => {
      render(<Header />);
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });
  });

  describe('Responsive behavior', () => {
    it('renders the menu button', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });

      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });
      expect(menuButton).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has correct header role', () => {
      render(<Header />);
      const header = screen.getByRole('banner');
      expect(header).toBeInTheDocument();
    });

    it('menu button has correct aria-label', () => {
      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });
      expect(menuButton).toHaveAttribute('aria-label', 'openMenu');
    });

    it('supports keyboard navigation', () => {
      render(<Header />);
      const menuButton = screen.getByRole('button', { name: /openMenu/i });

      menuButton.focus();
      expect(document.activeElement).toBe(menuButton);
    });
  });

  describe('Error handling', () => {
    it('renders the header without errors', () => {
      render(<Header />);
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });
  });
});
