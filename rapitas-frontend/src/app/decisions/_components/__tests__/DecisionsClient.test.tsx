import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import DecisionsClient from '../DecisionsClient';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ categories: [], themes: [] }),
}));

const makeDecision = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  decision: 'TypeScriptの採用を決定',
  context: 'チームの生産性向上のため',
  rationale: '型安全性による品質向上',
  predictedOutcome: '3ヶ月でバグが50%減少',
  confidence: 0.7,
  reviewDate: null,
  actualOutcome: null,
  calibration: 'pending',
  status: 'open',
  themeId: null,
  taskId: null,
  reviewedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function setupFetch(
  decisions = [makeDecision()],
  reviewDue: ReturnType<typeof makeDecision>[] = [],
) {
  global.fetch = vi.fn((url: string) => {
    if ((url as string).includes('/review-due')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ decisions: reviewDue }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ decisions, total: decisions.length }),
    });
  }) as unknown as typeof fetch;
}

describe('DecisionsClient', () => {
  beforeEach(() => {
    setupFetch();
  });

  it('renders the page title', async () => {
    renderWithProviders(<DecisionsClient />);
    expect(screen.getByText('意思決定')).toBeInTheDocument();
  });

  it('fetches and displays decisions', async () => {
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => {
      expect(screen.getByText('TypeScriptの採用を決定')).toBeInTheDocument();
    });
  });

  it('shows empty state when no decisions', async () => {
    setupFetch([]);
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => {
      expect(screen.getByText(/記録された意思決定はありません/)).toBeInTheDocument();
    });
  });

  it('opens add modal when button clicked', async () => {
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => screen.getByText('TypeScriptの採用を決定'));
    fireEvent.click(screen.getByText('決定を記録'));
    expect(screen.getByPlaceholderText(/決定内容/)).toBeInTheDocument();
  });

  it('shows status filter tabs', async () => {
    renderWithProviders(<DecisionsClient />);
    expect(screen.getByText('未レビュー')).toBeInTheDocument();
    expect(screen.getByText('レビュー済')).toBeInTheDocument();
    expect(screen.getByText('アーカイブ')).toBeInTheDocument();
    expect(screen.getByText('すべて')).toBeInTheDocument();
  });

  it('shows review button with count when review-due items exist', async () => {
    const overdue = makeDecision({ reviewDate: '2020-01-01T00:00:00Z' });
    setupFetch([makeDecision()], [overdue]);
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => {
      expect(screen.getByText('今日のレビュー')).toBeInTheDocument();
    });
  });

  it('does not show review button when no review-due items', async () => {
    setupFetch([makeDecision()], []);
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => screen.getByText('TypeScriptの採用を決定'));
    expect(screen.queryByText('今日のレビュー')).not.toBeInTheDocument();
  });

  it('opens review modal and submits review', async () => {
    const overdue = makeDecision({ reviewDate: '2020-01-01T00:00:00Z' });
    setupFetch([makeDecision()], [overdue]);

    global.fetch = vi.fn((url: string) => {
      if ((url as string).includes('/review-due')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ decisions: [overdue] }) });
      }
      if ((url as string).includes('/review')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ decisions: [makeDecision()], total: 1 }),
      });
    }) as unknown as typeof fetch;

    renderWithProviders(<DecisionsClient />);
    await waitFor(() => expect(screen.getByText('今日のレビュー')).toBeInTheDocument());

    fireEvent.click(screen.getByText('今日のレビュー'));
    await waitFor(() => {
      expect(screen.getByText(/今日のレビュー 1 \/ 1/)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('実際の結果');
    fireEvent.change(textarea, { target: { value: '予測通り成功した' } });
    fireEvent.click(screen.getByText('記録して完了'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/review'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows task badge when decision is converted', async () => {
    setupFetch([makeDecision({ taskId: 42 })]);
    renderWithProviders(<DecisionsClient />);
    await waitFor(() => {
      expect(screen.getByText('タスク化済 #42')).toBeInTheDocument();
    });
  });

  it('calls delete API when trash button clicked', async () => {
    const mockFetch = vi.fn((url: string) => {
      if ((url as string).includes('/review-due')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ decisions: [] }) });
      }
      if ((url as string).endsWith('/1') && !url.includes('filter')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ decisions: [makeDecision()], total: 1 }),
      });
    }) as unknown as typeof fetch;
    global.fetch = mockFetch;

    renderWithProviders(<DecisionsClient />);
    await waitFor(() => screen.getByText('TypeScriptの採用を決定'));

    const deleteBtn = screen.getByTitle('削除');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/decision-journal/1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
