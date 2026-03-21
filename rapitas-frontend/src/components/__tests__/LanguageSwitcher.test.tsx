import { render, screen, fireEvent } from '@testing-library/react';
import LanguageSwitcher from '../LanguageSwitcher';

const mockSetLocale = vi.fn();

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: () => ({
    locale: 'ja',
    setLocale: mockSetLocale,
  }),
}));

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a button with correct aria-label for Japanese locale', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', { name: 'Switch to English' });
    expect(button).toBeInTheDocument();
  });

  it('displays "EN" text when current locale is ja', () => {
    render(<LanguageSwitcher />);

    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('toggles to English when clicked', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', { name: 'Switch to English' });
    fireEvent.click(button);

    expect(mockSetLocale).toHaveBeenCalledWith('en');
  });
});

describe('LanguageSwitcher (English locale)', () => {
  it('displays "JA" and correct aria-label when locale is en', async () => {
    vi.doMock('@/stores/locale-store', () => ({
      useLocaleStore: () => ({
        locale: 'en',
        setLocale: mockSetLocale,
      }),
    }));

    vi.resetModules();
    const { default: EnSwitcher } = await import('../LanguageSwitcher');
    const { render: renderFresh, screen: screenFresh } =
      await import('@testing-library/react');

    renderFresh(<EnSwitcher />);

    expect(screenFresh.getByText('JA')).toBeInTheDocument();
    expect(
      screenFresh.getByRole('button', { name: '日本語に切替' }),
    ).toBeInTheDocument();
  });

  it('toggles to Japanese when clicked in English mode', async () => {
    const mockSetLocaleFn = vi.fn();
    vi.doMock('@/stores/locale-store', () => ({
      useLocaleStore: () => ({
        locale: 'en',
        setLocale: mockSetLocaleFn,
      }),
    }));

    vi.resetModules();
    const { default: EnSwitcher } = await import('../LanguageSwitcher');
    const {
      render: renderFresh,
      screen: screenFresh,
      fireEvent: fireEventFresh,
    } = await import('@testing-library/react');

    renderFresh(<EnSwitcher />);

    const button = screenFresh.getByRole('button');
    fireEventFresh.click(button);

    expect(mockSetLocaleFn).toHaveBeenCalledWith('ja');
  });
});
