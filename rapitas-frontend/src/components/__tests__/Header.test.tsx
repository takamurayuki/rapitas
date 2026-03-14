import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../Header';

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

vi.mock('@/hooks/use-dark-mode', () => ({
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

vi.mock('@/stores/appModeStore', () => ({
  useAppModeStore: (selector: (state: { mode: string }) => unknown) =>
    selector({ mode: 'normal' }),
}));

vi.mock('@/stores/noteStore', () => ({
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
vi.mock('@/components/AppIcon', () => ({
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

// Mock lucide-react icons used in Header
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Icon = ({ className }: { className?: string }) => (
      <div data-testid={name} className={className} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Menu: createIcon('menu-icon'),
    Home: createIcon('home-icon'),
    Columns3: createIcon('columns3-icon'),
    List: createIcon('list-icon'),
    Tags: createIcon('tags-icon'),
    SwatchBook: createIcon('swatchbook-icon'),
    Search: createIcon('search-icon'),
    X: createIcon('x-icon'),
    FolderOpen: createIcon('folder-open-icon'),
    FolderKanban: createIcon('folder-kanban-icon'),
    ChevronDown: createIcon('chevron-down-icon'),
    ChevronRight: createIcon('chevron-right-icon'),
    Target: createIcon('target-icon'),
    BarChart3: createIcon('bar-chart3-icon'),
    Trophy: createIcon('trophy-icon'),
    Flame: createIcon('flame-icon'),
    Brain: createIcon('brain-icon'),
    FileText: createIcon('file-text-icon'),
    Calendar: createIcon('calendar-icon'),
    Clock: createIcon('clock-icon'),
    GraduationCap: createIcon('graduation-cap-icon'),
    Keyboard: createIcon('keyboard-icon'),
    Bot: createIcon('bot-icon'),
    CheckCircle: createIcon('check-circle-icon'),
    Settings: createIcon('settings-icon'),
    Github: createIcon('github-icon'),
    GitPullRequest: createIcon('git-pull-request-icon'),
    CircleDot: createIcon('circle-dot-icon'),
    Code: createIcon('code-icon'),
    Key: createIcon('key-icon'),
    Pin: createIcon('pin-icon'),
    PinOff: createIcon('pin-off-icon'),
    MessageSquare: createIcon('message-square-icon'),
    SquareArrowDown: createIcon('square-arrow-down-icon'),
    EllipsisVertical: createIcon('ellipsis-vertical-icon'),
    Moon: createIcon('moon-icon'),
    Sun: createIcon('sun-icon'),
    BookMarked: createIcon('book-marked-icon'),
    RotateCw: createIcon('rotate-cw-icon'),
    Loader2: createIcon('loader2-icon'),
    Sparkles: createIcon('sparkles-icon'),
    NotebookTabs: createIcon('notebook-tabs-icon'),
    User: createIcon('user-icon'),
    LogOut: createIcon('log-out-icon'),
    Package: createIcon('package-icon'),
  };
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
      const searchInput = screen.getByPlaceholderText(
        'searchPlaceholder',
      ) as HTMLInputElement;
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
