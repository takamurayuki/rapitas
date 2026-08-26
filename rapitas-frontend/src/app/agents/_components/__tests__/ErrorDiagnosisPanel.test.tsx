import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ErrorDiagnosisPanel } from '../ErrorDiagnosisPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const BASE_DIAGNOSIS = {
  id: 'diag-1',
  tsMs: 1,
  taskId: 612,
  phase: 'manual',
  fromProvider: 'openai',
  fromModel: 'gpt-5',
  rootCause: 'connection reset by peer',
  confidence: 70,
  suggestedAction: 'retry',
  reasoning: 'transient network blip',
  llmLatencyMs: 5000,
  llmModel: 'claude-haiku-4-5-20251001',
  feedback: null,
};

function mockGetResponse(diagnoses: unknown[], summary?: Partial<Record<string, number>>) {
  return {
    ok: true,
    json: async () => ({
      diagnoses,
      summary: {
        total: diagnoses.length,
        avgConfidence: 0,
        feedbackRate: 0,
        helpfulRate: 0,
        ...summary,
      },
      windowDays: 45,
      generatedAtMs: 1,
    }),
  };
}

describe('ErrorDiagnosisPanel', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before the first response arrives', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<ErrorDiagnosisPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the empty state when no diagnoses are recorded', async () => {
    mockFetch.mockResolvedValue(mockGetResponse([]));

    render(<ErrorDiagnosisPanel />);

    await waitFor(() => expect(screen.getByText('errorDiagnosis.empty')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/agents/error-diagnosis');
  });

  it('renders one row per diagnosis with root cause / confidence / action', async () => {
    mockFetch.mockResolvedValue(mockGetResponse([BASE_DIAGNOSIS]));

    render(<ErrorDiagnosisPanel />);

    await waitFor(() => expect(screen.getByText('connection reset by peer')).toBeInTheDocument());
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('retry')).toBeInTheDocument();
    expect(screen.queryByText('errorDiagnosis.lowConfidence')).not.toBeInTheDocument();
  });

  it('flags low-confidence rows', async () => {
    mockFetch.mockResolvedValue(mockGetResponse([{ ...BASE_DIAGNOSIS, confidence: 30 }]));

    render(<ErrorDiagnosisPanel />);

    await waitFor(() =>
      expect(screen.getByText('errorDiagnosis.lowConfidence')).toBeInTheDocument(),
    );
  });

  it('shows the load-failed message when the fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    render(<ErrorDiagnosisPanel />);

    await waitFor(() => expect(screen.getByText('errorDiagnosis.loadFailed')).toBeInTheDocument());
  });

  it('submits helpful feedback and reloads the list', async () => {
    mockFetch.mockResolvedValueOnce(mockGetResponse([BASE_DIAGNOSIS]));

    render(<ErrorDiagnosisPanel />);
    await waitFor(() => expect(screen.getByText('connection reset by peer')).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    mockFetch.mockResolvedValueOnce(mockGetResponse([{ ...BASE_DIAGNOSIS, feedback: 'helpful' }]));

    fireEvent.click(screen.getByRole('button', { name: 'helpful' }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3001/agents/error-diagnosis/diag-1/feedback',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
