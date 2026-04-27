import { render, screen, waitFor } from '@testing-library/react';
import { DailyBriefingCard } from '../DailyBriefingCard';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));

const mockBriefing = {
  date: '2026-04-28',
  greeting: 'おはようございます！',
  summary: '今日は3件のタスクがあります',
  priorityTasks: [
    { id: 1, title: 'タスク1', reason: '期限超過', estimatedMinutes: 30 },
  ],
  warnings: ['期限超過2件'],
  insights: ['今週は順調'],
  ideaSuggestion: null,
  estimatedProductiveHours: 6,
};

describe('DailyBriefingCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, briefing: mockBriefing }),
      }),
    ) as unknown as typeof fetch;
  });

  it('fetches and displays briefing on mount', async () => {
    render(<DailyBriefingCard categoryId={null} />);
    await waitFor(() => {
      expect(screen.getByText('おはようございます！')).toBeInTheDocument();
    });
    expect(screen.getByText(/今日は3件のタスクがあります/)).toBeInTheDocument();
  });

  it('shows priority tasks', async () => {
    render(<DailyBriefingCard categoryId={null} />);
    await waitFor(() => {
      expect(screen.getByText('タスク1')).toBeInTheDocument();
    });
  });

  it('skips fetch when already loaded today', async () => {
    sessionStorage.setItem(
      'daily-briefing-date',
      new Date().toISOString().split('T')[0],
    );
    render(<DailyBriefingCard categoryId={null} />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles fetch error gracefully', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'failed' }),
      }),
    ) as unknown as typeof fetch;
    render(<DailyBriefingCard categoryId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/failed/)).toBeInTheDocument();
    });
  });
});
