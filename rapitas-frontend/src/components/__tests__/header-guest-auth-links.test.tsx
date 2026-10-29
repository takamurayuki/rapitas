/**
 * header-guest-auth-links.test
 *
 * Can someone who is not signed in actually reach the login screen?
 *
 * The entry point was removed on purpose when accounts bought nothing, and
 * /auth/login stayed reachable only by typing the URL — which is how it came
 * to be reported as "the login screen never appears". Workspace tenancy made
 * an account decide WHICH data you see, so the link is back, and this pins it
 * rather than trusting that nobody deletes it again.
 *
 * Separate file from Header.test.tsx because that one mocks useAuth as signed
 * in, and a module mock is per-file.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// The guest case: nobody signed in, which is every load until someone does.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
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

vi.mock('@/stores/shortcut-store', () => ({
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
vi.mock('@/components/common/app-icon', () => ({
  default: () => <div data-testid="app-icon" />,
}));

vi.mock('@/feature/tasks/pomodoro/GlobalPomodoroWidget', () => ({
  default: () => <div data-testid="pomodoro-widget" />,
}));

vi.mock('@/components/common/KeyboardShortcuts', () => ({
  OPEN_SHORTCUTS_EVENT: 'open-shortcuts',
}));

vi.mock('@/components/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell" />,
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

// NOTE: useHeader() throws without a ToastProvider ancestor (used for the
// restart-timeout toast). Mock the hook directly — same pattern as
// TaskCard.test.tsx.
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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

describe('Header — the way in for someone not signed in', () => {
  /** Open the user menu, which is where the entry points live. */
  async function openUserMenu(): Promise<void> {
    render(<Header />);
    fireEvent.click(await screen.findByLabelText('userMenu'));
  }

  it('offers a link to the login screen', async () => {
    await openUserMenu();
    expect(screen.getByText('login').closest('a')).toHaveAttribute('href', '/auth/login');
  });

  it('offers a link to create an account', async () => {
    await openUserMenu();
    expect(screen.getByText('register').closest('a')).toHaveAttribute('href', '/auth/register');
  });

  it('does not offer logout to someone who is not signed in', async () => {
    // The control: without it, a menu that rendered nothing at all would still
    // satisfy the two assertions above by never being asserted against.
    await openUserMenu();
    expect(screen.queryByText('logout')).toBeNull();
    expect(screen.getByText('rapiProfileLink')).toBeInTheDocument();
  });
});
