/**
 * RepairIterationMetricsPanel ユニットテスト
 *
 * 反復が無い場合は非表示、反復がある場合は変更セットサイズ・滞留時間の表示と
 * テスト成功率/学習速度の「算出不可」注記を検証する。
 */
import { render, screen, waitFor } from '@testing-library/react';
import RepairIterationMetricsPanel from '../RepairIterationMetricsPanel';

const mockT = (key: string, values?: Record<string, string | number>) => {
  if (key === 'taskWorkflowSection.repairIterationMetrics.title') return 'Per-iteration metrics';
  if (key === 'taskWorkflowSection.repairIterationMetrics.cause.verify_repair')
    return 'verify repair';
  if (key === 'taskWorkflowSection.repairIterationMetrics.cause.ci_repair') return 'ci repair';
  if (key === 'taskWorkflowSection.repairIterationMetrics.dwell' && values) {
    return `dwell ${values.time}`;
  }
  if (key === 'taskWorkflowSection.repairIterationMetrics.dwellNone') return 'no dwell data';
  if (key === 'taskWorkflowSection.repairIterationMetrics.changeSet' && values) {
    return `files ${values.files} (+${values.additions}/-${values.deletions})`;
  }
  if (key === 'taskWorkflowSection.repairIterationMetrics.changeSetNone') return 'no commit data';
  if (key === 'taskWorkflowSection.repairIterationMetrics.unavailableNote') {
    return 'test pass-rate delta and learning velocity cannot be computed';
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

/** Real backend path — workflowRoutes is mounted with prefix '/workflow' (workflow.ts). */
const REPAIR_ITERATIONS_PATH = 'http://test:3001/workflow/tasks/1/repair-iterations';

function mockIterations(iterations: unknown[]) {
  mockFetch.mockImplementation((url: string) => {
    // Exact match (not .includes) — a prefix-less path like /tasks/1/repair-iterations
    // must NOT match, since that would silently hide a wrong-URL regression (task #672).
    if (url === REPAIR_ITERATIONS_PATH) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, iterations }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

describe('RepairIterationMetricsPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('反復が無い場合は何も表示しない', async () => {
    mockIterations([]);
    const { container } = render(<RepairIterationMetricsPanel taskId={1} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('fetch失敗時は何も表示しない', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    const { container } = render(<RepairIterationMetricsPanel taskId={1} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('変更セットサイズと滞留時間を実データで表示し、算出不可の注記を含む', async () => {
    mockIterations([
      {
        id: 'repair-0',
        cause: 'verify_repair',
        createdAt: '2026-08-01T00:00:00.000Z',
        dwellTimeMs: null,
        changeSet: null,
      },
      {
        id: 'repair-1',
        cause: 'ci_repair',
        createdAt: '2026-08-01T00:05:00.000Z',
        dwellTimeMs: 300000,
        changeSet: { filesChanged: 3, additions: 30, deletions: 5 },
      },
    ]);

    render(<RepairIterationMetricsPanel taskId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Per-iteration metrics')).toBeInTheDocument();
    });
    // Regression guard (task #672): the fetch must hit the prefixed backend route
    // exactly, not a prefix-less path that 404s in production.
    expect(mockFetch).toHaveBeenCalledWith(REPAIR_ITERATIONS_PATH);
    expect(screen.getByText('no dwell data')).toBeInTheDocument();
    expect(screen.getByText('no commit data')).toBeInTheDocument();
    expect(screen.getByText('dwell 5:00')).toBeInTheDocument();
    expect(screen.getByText('files 3 (+30/-5)')).toBeInTheDocument();
    expect(
      screen.getByText('test pass-rate delta and learning velocity cannot be computed'),
    ).toBeInTheDocument();
  });

  it('success:false のレスポンスでは何も表示しない', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) }),
    );
    const { container } = render(<RepairIterationMetricsPanel taskId={1} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });
});
