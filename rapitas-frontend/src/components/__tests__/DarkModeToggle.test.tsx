import { render, screen, fireEvent } from '@testing-library/react';
import { DarkModeToggle } from '../DarkModeToggle';

const mockToggleTheme = vi.fn();

vi.mock('@/hooks/use-dark-mode', () => ({
  useDarkMode: () => ({
    isDarkMode: false,
    mounted: true,
    toggleTheme: mockToggleTheme,
  }),
}));

describe('DarkModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a button with aria-label', () => {
    render(<DarkModeToggle />);

    const button = screen.getByRole('button', { name: 'Toggle dark mode' });
    expect(button).toBeInTheDocument();
  });

  it('calls toggleTheme on click', () => {
    render(<DarkModeToggle />);

    const button = screen.getByRole('button', { name: 'Toggle dark mode' });
    fireEvent.click(button);

    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });
});

describe('DarkModeToggle (unmounted state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders placeholder button when not mounted', async () => {
    // Override mock for this test
    vi.doMock('@/hooks/use-dark-mode', () => ({
      useDarkMode: () => ({
        isDarkMode: false,
        mounted: false,
        toggleTheme: vi.fn(),
      }),
    }));

    // Re-import to get the new mock
    vi.resetModules();
    const { DarkModeToggle: UnmountedToggle } =
      await import('../DarkModeToggle');
    const { render: renderFresh, screen: screenFresh } =
      await import('@testing-library/react');

    renderFresh(<UnmountedToggle />);

    const button = screenFresh.getByRole('button', {
      name: 'Toggle dark mode',
    });
    expect(button).toBeInTheDocument();
  });
});
