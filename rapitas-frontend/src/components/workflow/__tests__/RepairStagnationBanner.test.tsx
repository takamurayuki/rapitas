/**
 * RepairStagnationBanner ユニットテスト
 *
 * 修復反復回数の閾値到達前は非表示、到達時は中立的な文言と
 * role="status" aria-live="polite" を持つバナーを表示することを検証する。
 */
import { render, screen, waitFor } from '@testing-library/react';
import RepairStagnationBanner from '../RepairStagnationBanner';

const mockT = (key: string, values?: Record<string, string | number>) => {
  if (key === 'taskWorkflowSection.repairStagnation.title' && values) {
    return `Repair iterations: ${values.count}`;
  }
  if (key === 'taskWorkflowSection.repairStagnation.message') {
    return 'This indicates the same repair loop has continued.';
  }
  if (key === 'taskWorkflowSection.repairStagnation.ariaLabel' && values) {
    return `${values.count} repair iterations recorded.`;
  }
  return key;
};
vi.mock('next-intl', () => ({
  useTranslations: () => mockT,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const mockFetch = vi.fn();

function mockTransitions(transitions: unknown[]) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/transitions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, transitions }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

describe('RepairStagnationBanner', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when the repair-iteration count is below the threshold', async () => {
    mockTransitions([
      { id: 1, cause: 'verify_repair', createdAt: '2026-08-01T10:00:00Z' },
      { id: 2, cause: 'ci_repair', createdAt: '2026-08-02T10:00:00Z' },
    ]);

    const { container } = render(<RepairStagnationBanner taskId={1} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders a neutral status banner once the threshold is reached', async () => {
    mockTransitions([
      { id: 1, cause: 'verify_repair', createdAt: '2026-08-01T10:00:00Z' },
      { id: 2, cause: 'ci_repair', createdAt: '2026-08-02T10:00:00Z' },
      { id: 3, cause: 'verify_repair', createdAt: '2026-08-03T10:00:00Z' },
    ]);

    render(<RepairStagnationBanner taskId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Repair iterations: 3')).toBeInTheDocument();
    });
    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveAttribute('aria-label', '3 repair iterations recorded.');
    expect(
      screen.getByText('This indicates the same repair loop has continued.'),
    ).toBeInTheDocument();
  });

  it('renders nothing when the fetch fails', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));

    const { container } = render(<RepairStagnationBanner taskId={1} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('ignores non-repair transitions when counting iterations', async () => {
    mockTransitions([
      { id: 1, cause: 'research_critic_failed', createdAt: '2026-08-01T10:00:00Z' },
      { id: 2, cause: 'verify_repair', createdAt: '2026-08-02T10:00:00Z' },
      { id: 3, cause: 'file_saved:verify', createdAt: '2026-08-03T10:00:00Z' },
    ]);

    const { container } = render(<RepairStagnationBanner taskId={1} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });
});
