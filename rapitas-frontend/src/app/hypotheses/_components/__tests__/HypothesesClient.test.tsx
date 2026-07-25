import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import HypothesesClient from '../HypothesesClient';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => vi.fn().mockResolvedValue(true),
}));

const mockThemes = [{ id: 5, name: 'rapitas', color: '#4f46e5', icon: null, sortOrder: 0 }];
vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ themes: mockThemes }),
}));

const mockHypotheses = [
  {
    id: 1,
    statement: 'キャッシュを有効化すれば応答が速くなる',
    rationale: '過去の計測から',
    domain: 'performance',
    status: 'open',
    confidence: 0.6,
    evidence: [],
    themeId: 5,
    originTaskId: null,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];

describe('HypothesesClient', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/hypotheses/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ open: 1, supported: 0, refuted: 0, inconclusive: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ hypotheses: mockHypotheses, total: 1 }),
      });
    }) as unknown as typeof fetch;
  });

  it('renders the origin theme name on a hypothesis card', async () => {
    renderWithProviders(<HypothesesClient />);
    await waitFor(() => {
      expect(screen.getByText('rapitas')).toBeInTheDocument();
    });
  });

  it('renders the header title without a boxed icon wrapper', async () => {
    const { container } = renderWithProviders(<HypothesesClient />);
    await waitFor(() => screen.getByText('header.title'));
    // The old header wrapped the Beaker icon in a bordered h-12 w-12 box —
    // asserting it's gone guards against re-adding the "outlined badge" look
    // the user asked to remove in favor of the other backlogs' plain icon.
    expect(container.querySelector('.h-12.w-12')).not.toBeInTheDocument();
  });
});
