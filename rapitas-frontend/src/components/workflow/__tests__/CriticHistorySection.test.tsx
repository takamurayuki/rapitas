/**
 * CriticHistorySection ユニットテスト
 *
 * 品質ゲート履歴セクションの表示条件 (該当遷移なし→非表示)、エントリの
 * 概要行 (フェーズ/種別/severity)、折りたたみの開閉挙動を検証する。
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CriticHistorySection from '../CriticHistorySection';

const mockT = (key: string, values?: Record<string, string | number>) => {
  if (key === 'taskWorkflowSection.criticHistory.title') return 'Quality gate history';
  if (key === 'taskWorkflowSection.criticHistory.entryLabel' && values) {
    return `${values.phase} · ${values.date}`;
  }
  if (key === 'taskWorkflowSection.criticHistory.phase.research') return 'Research';
  if (key === 'taskWorkflowSection.criticHistory.phase.plan') return 'Plan';
  if (key === 'taskWorkflowSection.criticHistory.type.bounced') return 'Bounced';
  if (key === 'taskWorkflowSection.criticHistory.type.exhausted') return 'Budget exhausted';
  if (key === 'taskWorkflowSection.criticHistory.severity.high') return 'High';
  if (key === 'taskWorkflowSection.criticHistory.severity.medium') return 'Medium';
  if (key === 'taskWorkflowSection.criticHistory.severity.low') return 'Low';
  if (key === 'taskWorkflowSection.criticHistory.reasonsCount' && values?.count != null) {
    return `${values.count} issue(s)`;
  }
  if (key === 'taskWorkflowSection.criticHistory.noReasons') return 'No details were recorded';
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

describe('CriticHistorySection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when no critic-gate transition exists', async () => {
    mockTransitions([{ id: 1, cause: 'file_saved:research', createdAt: '2026-08-01T10:00:00Z' }]);

    const { container } = render(<CriticHistorySection taskId={1} />);

    // The fetch resolves asynchronously — wait for it before asserting emptiness.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders the heading, count badge and one summary row per critic entry', async () => {
    mockTransitions([
      {
        id: 1,
        cause: 'research_critic_failed',
        phase: 'research',
        metadata: { severity: 92, reasons: ['missing dependency map'] },
        createdAt: '2026-08-01T10:00:00Z',
      },
      {
        id: 2,
        cause: 'plan_critic_failed',
        phase: 'plan',
        metadata: { severity: 55, reasons: ['no risk section'] },
        createdAt: '2026-08-02T11:30:00Z',
      },
    ]);

    render(<CriticHistorySection taskId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Quality gate history')).toBeInTheDocument();
    });
    expect(screen.getByText('2 issue(s)')).toBeInTheDocument();
    expect(screen.getByText(/^Research ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Plan ·/)).toBeInTheDocument();
    expect(screen.getAllByText('Bounced')).toHaveLength(2);
    expect(screen.getByText('High (92)')).toBeInTheDocument();
    expect(screen.getByText('Medium (55)')).toBeInTheDocument();
  });

  it('collapses reasons by default and reveals them on trigger click', async () => {
    mockTransitions([
      {
        id: 1,
        cause: 'plan_critic_failed',
        phase: 'plan',
        metadata: { severity: 70, reasons: ['reason alpha', 'reason beta'] },
        createdAt: '2026-08-01T10:00:00Z',
      },
    ]);

    render(<CriticHistorySection taskId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/^Plan ·/)).toBeInTheDocument();
    });
    expect(screen.queryByText('reason alpha')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Plan ·/ }));

    expect(screen.getByText('reason alpha')).toBeInTheDocument();
    expect(screen.getByText('reason beta')).toBeInTheDocument();

    // Clicking again collapses the entry back.
    fireEvent.click(screen.getByRole('button', { name: /Plan ·/ }));
    expect(screen.queryByText('reason alpha')).not.toBeInTheDocument();
  });

  it('includes exhausted-type transitions and shows the fallback when reasons are absent', async () => {
    mockTransitions([
      {
        id: 1,
        cause: 'research_critic_exhausted',
        phase: 'research',
        metadata: { severity: 88, reasons: [] },
        createdAt: '2026-08-01T10:00:00Z',
      },
    ]);

    render(<CriticHistorySection taskId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Budget exhausted')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Research ·/ }));
    expect(screen.getByText('No details were recorded')).toBeInTheDocument();
  });

  it('renders nothing when the fetch fails', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));

    const { container } = render(<CriticHistorySection taskId={1} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });
});
