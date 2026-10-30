/**
 * register page layout
 *
 * Pins the order of the two ways to create an account: the form first, the
 * Google button under the divider — the same shape as /auth/login.
 *
 * The register screen used to put Google ABOVE the form while login put it
 * below, so moving between the two screens moved the primary action. These
 * tests fail on that arrangement rather than on anything about the styling,
 * so a future redesign is free as long as both screens still agree.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegisterPage from '../page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Keys come back as-is, so the buttons are named by their translation key.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    register: vi.fn(),
    loginWithGoogle: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

/** True when `later` sits after `earlier` in document order. */
function comesAfter(earlier: Element, later: Element): boolean {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** data-testids of the mocked icons rendered inside one field's wrapper. */
function iconsInside(input: HTMLElement): string[] {
  const wrapper = input.parentElement;
  if (!wrapper) return [];
  return Array.from(wrapper.querySelectorAll('[data-testid$="-icon"]')).map(
    (el) => el.getAttribute('data-testid') ?? '',
  );
}

describe('RegisterPage fields', () => {
  it.each(['username', 'email'])('starts the text at the left edge of %s', (label) => {
    // A decorative icon inside the field reserved 40px on the left, so the
    // text began well away from the edge and the gutter after it read as
    // empty space. Nothing decorative may sit inside the field any more.
    render(<RegisterPage />);
    expect(iconsInside(screen.getByLabelText(label))).toEqual([]);
  });

  it.each(['password', 'confirmPassword'])('keeps only the show-password toggle in %s', (label) => {
    // The eye is interactive, not decoration, and it is what the right-hand
    // padding on these two fields exists for.
    render(<RegisterPage />);
    expect(iconsInside(screen.getByLabelText(label))).toEqual(['Eye-icon']);
  });
});

describe('RegisterPage layout', () => {
  it('puts the Google button below the create-account button', () => {
    render(<RegisterPage />);
    const submit = screen.getByRole('button', { name: /createAccount/ });
    const google = screen.getByRole('button', { name: /createWithGoogle/ });
    expect(comesAfter(submit, google)).toBe(true);
  });

  it('keeps both sign-up routes inside the one form', () => {
    // On login both buttons share a single <form>; a Google button parked
    // outside it is the arrangement this screen is moving away from.
    render(<RegisterPage />);
    const google = screen.getByRole('button', { name: /createWithGoogle/ });
    const submit = screen.getByRole('button', { name: /createAccount/ });
    expect(google.closest('form')).not.toBeNull();
    expect(google.closest('form')).toBe(submit.closest('form'));
  });

  it('shows the divider between them', () => {
    render(<RegisterPage />);
    const divider = screen.getByText('or');
    const submit = screen.getByRole('button', { name: /createAccount/ });
    const google = screen.getByRole('button', { name: /createWithGoogle/ });
    expect(comesAfter(submit, divider)).toBe(true);
    expect(comesAfter(divider, google)).toBe(true);
  });
});
