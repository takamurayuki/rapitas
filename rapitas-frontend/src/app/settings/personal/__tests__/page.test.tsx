/**
 * settings/personal/__tests__/page.test.tsx
 *
 * The page the self-introduction moved to (#1275).
 *
 * It was a card on /settings/general, reached by an anchor jump from the
 * header, next to the UI language and the backup controls. It is the one
 * thing in settings that is about the person rather than the machine, and
 * since it is now stored per account it belongs on its own page behind the
 * sign-in.
 *
 * What these tests hold: the page actually renders the card (an anchor link
 * to a page that does not render it is the failure mode of a move like
 * this), and the heading says whose settings these are.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PersonalSettingsPage from '../page';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// requireAuth is a pass-through wrapper, but the page imports the whole
// AuthContext module, which reaches for the API on import.
vi.mock('@/contexts/AuthContext', () => ({
  requireAuth: <P extends object>(Component: React.ComponentType<P>) => Component,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

beforeEach(() => {
  // The card reads GET /settings on mount.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ rapiProfile: '', rapiCharacter: '' }),
    })),
  );
});

describe('the personal settings page', () => {
  it('renders the self-introduction card', async () => {
    render(<PersonalSettingsPage />);
    expect(await screen.findByText('settings.rapiProfile.title')).toBeInTheDocument();
  });

  it('renders the second half, how they like to work', async () => {
    render(<PersonalSettingsPage />);
    expect(await screen.findByText('settings.rapiProfile.characterTitle')).toBeInTheDocument();
  });

  it('names itself in its heading', () => {
    render(<PersonalSettingsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('personal.title');
  });
});
