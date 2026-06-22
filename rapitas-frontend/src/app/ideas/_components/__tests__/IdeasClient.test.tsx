import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import IdeasClient from '../IdeasClient';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ categories: [], themes: [] }),
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
    renderWithProviders(<IdeasClient />);
    expect(screen.getByText('アイデア')).toBeInTheDocument();
  });

  it('fetches and displays ideas', async () => {
    renderWithProviders(<IdeasClient />);
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
    renderWithProviders(<IdeasClient />);
    await waitFor(() => {
      expect(screen.getByText(/アイデアがまだありません/)).toBeInTheDocument();
    });
  });

  it('opens quick add form when button clicked', async () => {
    renderWithProviders(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));
    fireEvent.click(screen.getByText('アイデアを追加'));
    expect(screen.getByPlaceholderText(/アイデアをひとことで/)).toBeInTheDocument();
  });

  it('does not show pagination when total pages is 1', async () => {
    renderWithProviders(<IdeasClient />);
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
        json: () => Promise.resolve({ ideas: mockIdeas, total: 40 }),
      });
    }) as unknown as typeof fetch;

    renderWithProviders(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));
    // 総数40、itemsPerPage=10なので4ページ => ページネーション表示される
    // (4 はページサイズ候補[5,10,15]に無く一意に取れる)
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

    renderWithProviders(<IdeasClient />);
    await waitFor(() => screen.getByText('テストアイデア'));

    // 初期APIコールを確認
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=10&offset=0'));
  });
});
