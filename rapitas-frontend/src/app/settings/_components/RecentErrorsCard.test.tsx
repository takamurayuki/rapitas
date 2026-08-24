/**
 * RecentErrorsCard.test.tsx
 *
 * Verifies the risk badge rendering rules: shown for medium and above,
 * hidden for `low` and for entries without a riskLevel field.
 */
import { render, screen } from '@testing-library/react';
import RecentErrorsCard from './RecentErrorsCard';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (s: { locale: string }) => unknown) => selector({ locale: 'ja' }),
}));

const ERRORS_RESPONSE = {
  sentryEnabled: false,
  errors: [
    {
      id: 'e1',
      source: 'explicit',
      message: 'high risk error',
      timestamp: '2026-08-24T00:00:00.000Z',
      riskLevel: 'high',
    },
    {
      id: 'e2',
      source: 'frontend',
      message: 'plain error without risk',
      timestamp: '2026-08-24T00:00:01.000Z',
    },
    {
      id: 'e3',
      source: 'explicit',
      message: 'low risk error',
      timestamp: '2026-08-24T00:00:02.000Z',
      riskLevel: 'low',
    },
    {
      id: 'e4',
      source: 'explicit',
      message: 'critical risk error',
      timestamp: '2026-08-24T00:00:03.000Z',
      riskLevel: 'critical',
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ERRORS_RESPONSE,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecentErrorsCard — risk badge', () => {
  it('renders a badge for entries at medium risk or above', async () => {
    render(<RecentErrorsCard />);
    expect(await screen.findByText('riskLevelHigh')).toBeTruthy();
    expect(screen.getByText('riskLevelCritical')).toBeTruthy();
  });

  it('renders no badge for low or missing riskLevel', async () => {
    render(<RecentErrorsCard />);
    await screen.findByText('high risk error');
    expect(screen.queryByText('riskLevelMedium')).toBeNull();
    // Rows e2 (undefined) and e3 (low) exist but carry no risk badge:
    // only the two badges from e1/e4 are present.
    expect(screen.getByText('plain error without risk')).toBeTruthy();
    expect(screen.getByText('low risk error')).toBeTruthy();
    expect(screen.getAllByText(/^riskLevel/).length).toBe(2);
  });
});
