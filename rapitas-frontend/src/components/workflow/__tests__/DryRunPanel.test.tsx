/**
 * DryRunPanel ユニットテスト
 *
 * ボタン押下→ローディング→結果表示、404エラー表示、履歴表示、
 * drift 警告バナー表示を検証する。
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DryRunPanel from '../DryRunPanel';

const mockT = (key: string, values?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    'dryRun.title': 'Dry run',
    'dryRun.button': 'Run dry run',
    'dryRun.running': 'Running...',
    'dryRun.error': 'Failed to run the dry run',
    'dryRun.resultOk': 'Likely to pass',
    'dryRun.resultNg': 'May be bounced',
    'dryRun.gateLabel': 'Deterministic gate',
    'dryRun.completionGateLabel': 'Completion gate',
    'dryRun.juryLabel': 'Adversarial review',
    'dryRun.pass': 'Pass',
    'dryRun.fail': 'Fail',
    'dryRun.juryVerdict.pass': 'Pass',
    'dryRun.juryVerdict.fail': 'Fail',
    'dryRun.juryVerdict.unknown': 'Unknown',
    'dryRun.baseBranchShaUnavailable': 'No base branch SHA',
    'dryRun.skippedOperationsTitle': 'Skipped operations',
    'dryRun.historyTitle': 'Past dry runs',
    'dryRun.historyEmpty': 'No dry runs yet',
    'dryRun.checkDrift': 'Check for drift',
    'dryRun.driftChecking': 'Checking...',
    'dryRun.driftNone': 'No change',
  };
  if (key === 'dryRun.baseBranchSha' && values) return `Base branch SHA: ${values.sha}`;
  if (key === 'dryRun.driftDetected' && values) return `Drifted by ${values.count} commits`;
  if (key.startsWith('dryRun.skippedOperations.')) return key.split('.').pop() as string;
  if (key.startsWith('dryRun.driftNote.')) return key.split('.').pop() as string;
  return map[key] ?? key;
};
vi.mock('next-intl', () => ({
  useTranslations: () => mockT,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const mockFetch = vi.fn();
const DRY_RUN_PATH = 'http://test:3001/workflow/tasks/1/dry-run';
const HISTORY_PATH = 'http://test:3001/workflow/tasks/1/dry-run/history';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

describe('DryRunPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockImplementation((url: string) => {
      if (url === HISTORY_PATH) return jsonResponse({ success: true, reports: [] });
      return jsonResponse({ success: false, error: 'unexpected call' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches history on mount and shows the empty state', async () => {
    render(<DryRunPanel taskId={1} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(HISTORY_PATH, expect.anything()));
    expect(await screen.findByText('No dry runs yet')).toBeInTheDocument();
  });

  it('runs a dry run and shows the result summary on button click', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === HISTORY_PATH) return jsonResponse({ success: true, reports: [] });
      if (url === DRY_RUN_PATH) {
        return jsonResponse({
          success: true,
          ok: true,
          gate: { ok: true, summary: 'ok' },
          completionGate: { allow: true, reason: 'has_code_changes' },
          jury: { verdict: 'pass', severity: 0, reasons: [] },
          baseBranchSha: 'abcdef123456',
          skippedOperations: ['commit'],
          reportId: 42,
        });
      }
      return jsonResponse({ success: false }, false);
    });

    render(<DryRunPanel taskId={1} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(HISTORY_PATH, expect.anything()));

    fireEvent.click(screen.getByText('Run dry run'));

    expect(await screen.findByText('Likely to pass')).toBeInTheDocument();
    expect(screen.getByText('Base branch SHA: abcdef12')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      DRY_RUN_PATH,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an error message when the dry-run endpoint reports failure (e.g. 404 no worktree)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === HISTORY_PATH) return jsonResponse({ success: true, reports: [] });
      if (url === DRY_RUN_PATH) {
        return jsonResponse({ success: false, error: 'worktree not found' });
      }
      return jsonResponse({ success: false }, false);
    });

    render(<DryRunPanel taskId={1} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(HISTORY_PATH, expect.anything()));
    fireEvent.click(screen.getByText('Run dry run'));

    expect(await screen.findByText('worktree not found')).toBeInTheDocument();
  });

  it('lists past reports and shows a drift warning banner on demand', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === HISTORY_PATH) {
        return jsonResponse({
          success: true,
          reports: [{ id: 7, createdAt: '2026-08-29T00:00:00.000Z', payload: { ok: true } }],
        });
      }
      if (url === 'http://test:3001/workflow/tasks/1/dry-run/7/drift') {
        return jsonResponse({ success: true, driftDetected: true, commitsBehind: 3 });
      }
      return jsonResponse({ success: false }, false);
    });

    render(<DryRunPanel taskId={1} />);
    const historyToggle = await screen.findByText(/Pass/);
    fireEvent.click(historyToggle);

    fireEvent.click(screen.getByText('Check for drift'));

    expect(await screen.findByText('Drifted by 3 commits')).toBeInTheDocument();
  });
});
