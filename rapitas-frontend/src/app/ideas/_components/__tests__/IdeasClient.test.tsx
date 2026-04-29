import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import IdeasClient from '../IdeasClient';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ categories: [], themes: [], initializeData: vi.fn() }),
}));

const mockIdeas = [
  {
    id: 1,
    title: 'テストアイデア',
    content: '内容',
    category: 'improvement',
    scope: 'global',
    tags: [],
    themeId: null,
    source: 'user',
    usedInTaskId: null,
    createdAt: '2026-04-28T00:00:00Z',
  },
];

describe('IdeasClient', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/idea-box/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ total: 1, unused: 1, byCategory: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: mockIdeas, total: 1 }),
      });
    }) as unknown as typeof fetch;
  });

  it('renders the page title', async () => {
    render(<IdeasClient />);
    expect(screen.getByText('アイデアボックス')).toBeInTheDocument();
  });

  it('fetches and displays ideas', async () => {
    render(<IdeasClient />);
    await waitFor(() => {
      expect(screen.getByText('テストアイデア')).toBeInTheDocument();
    });
  });

  it('shows empty state when no ideas', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: [], total: 0 }),
      }),
    ) as unknown as typeof fetch;
    render(<IdeasClient />);
    await waitFor(() => {
      expect(screen.getByText(/アイデアがまだありません/)).toBeInTheDocument();
    });
  });

  it('opens quick add form when button clicked', async () => {
    render(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));
    fireEvent.click(screen.getByText('アイデアを追加'));
    expect(screen.getByPlaceholderText(/アイデアをひとことで/)).toBeInTheDocument();
  });

  it('does not show pagination when total pages is 1', async () => {
    render(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));
    // Paginationコンポーネントは totalPages <= 1 の場合非表示
    expect(screen.queryByRole('button', { name: /ページ/ })).not.toBeInTheDocument();
  });

  it('shows pagination when there are multiple pages', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/idea-box/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ total: 50, unused: 30, byCategory: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: mockIdeas, total: 50 }),
      });
    }) as unknown as typeof fetch;

    render(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));
    // 総数50、itemsPerPage=15なので4ページ => ページネーション表示される
    expect(screen.getByText('4')).toBeInTheDocument(); // 最後のページ番号
  });

  it('calls API with correct limit and offset parameters', async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes('/idea-box/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ total: 50, unused: 30 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: mockIdeas, total: 50 }),
      });
    }) as unknown as typeof fetch;
    global.fetch = mockFetch;

    render(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));

    // 初期APIコールを確認
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=15&offset=0'));
  });
});
