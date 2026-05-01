import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import KnowledgeClient from '../KnowledgeClient';

// Mock modules
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/hooks/common/useLocalStorageState');
vi.mock('@/feature/knowledge/hooks/useKnowledge');
vi.mock('@/feature/knowledge/hooks/useKnowledgeSearch');
vi.mock('@/feature/knowledge/hooks/useMemoryStats');

const mockKnowledgeEntries = [
  {
    id: 1,
    title: 'テスト知識1',
    content: 'テスト内容1',
    category: 'general',
    sourceType: 'user_learning',
    createdAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 2,
    title: 'テスト知識2',
    content: 'テスト内容2',
    category: 'procedure',
    sourceType: 'user_learning',
    createdAt: '2026-05-01T01:00:00Z',
  },
];

describe('KnowledgeClient', () => {
  let mockSetItemsPerPage: ReturnType<typeof vi.fn>;
  let mockUseKnowledge: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock localStorage state
    mockSetItemsPerPage = vi.fn();
    const { useLocalStorageState } = await import('@/hooks/common/useLocalStorageState');
    vi.mocked(useLocalStorageState).mockReturnValue([15, mockSetItemsPerPage]);

    // Mock knowledge hook
    mockUseKnowledge = vi.fn().mockReturnValue({
      entries: mockKnowledgeEntries,
      total: 25,
      totalPages: 2,
      isLoading: false,
      createEntry: vi.fn(),
    });
    const { useKnowledge } = await import('@/feature/knowledge/hooks/useKnowledge');
    vi.mocked(useKnowledge).mockImplementation(mockUseKnowledge);

    // Mock search hook
    const { useKnowledgeSearch } = await import('@/feature/knowledge/hooks/useKnowledgeSearch');
    vi.mocked(useKnowledgeSearch).mockReturnValue({
      results: [],
      isSearching: false,
      search: vi.fn(),
    });

    // Mock stats hook
    const { useMemoryStats } = await import('@/feature/knowledge/hooks/useMemoryStats');
    vi.mocked(useMemoryStats).mockReturnValue({
      stats: null,
    });

    // Mock scroll behavior
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('初期表示でページサイズ15件でAPIを呼び出すこと', async () => {
    render(<KnowledgeClient />);

    expect(mockUseKnowledge).toHaveBeenCalledWith({
      page: 1,
      limit: 15,
      category: undefined,
      forgettingStage: undefined,
      validationStatus: undefined,
    });
  });

  it('知識エントリーが表示されること', async () => {
    render(<KnowledgeClient />);

    await waitFor(() => {
      expect(screen.getByText('テスト知識1')).toBeInTheDocument();
      expect(screen.getByText('テスト知識2')).toBeInTheDocument();
    });
  });

  it('Paginationコンポーネントが表示されること', async () => {
    render(<KnowledgeClient />);

    await waitFor(() => {
      // Paginationコンポーネントの要素を確認
      expect(screen.getByRole('button', { name: '15' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '次のページ' })).toBeInTheDocument();
    });
  });

  it('ページサイズ変更時にlocalStorageとページが更新されること', async () => {
    render(<KnowledgeClient />);

    await waitFor(() => {
      const button10 = screen.getByRole('button', { name: '10' });
      fireEvent.click(button10);

      expect(mockSetItemsPerPage).toHaveBeenCalledWith(10);
    });
  });

  it('フィルタ変更時にページが1にリセットされること', async () => {
    render(<KnowledgeClient />);

    await waitFor(() => {
      // カテゴリフィルターを変更
      const categoryFilter = screen.getByRole('combobox', { name: /カテゴリ/i });
      fireEvent.change(categoryFilter, { target: { value: 'procedure' } });

      // 最新の呼び出しでpage: 1になっていることを確認
      const lastCall = mockUseKnowledge.mock.calls[mockUseKnowledge.mock.calls.length - 1][0];
      expect(lastCall.page).toBe(1);
    });
  });

  it('エントリーが0件の場合Paginationが非表示になること', async () => {
    mockUseKnowledge.mockReturnValue({
      entries: [],
      total: 0,
      totalPages: 0,
      isLoading: false,
      createEntry: vi.fn(),
    });

    render(<KnowledgeClient />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '15' })).not.toBeInTheDocument();
    });
  });

  it('ローディング中はPaginationが非表示になること', async () => {
    mockUseKnowledge.mockReturnValue({
      entries: mockKnowledgeEntries,
      total: 25,
      totalPages: 2,
      isLoading: true,
      createEntry: vi.fn(),
    });

    render(<KnowledgeClient />);

    expect(screen.queryByRole('button', { name: '15' })).not.toBeInTheDocument();
  });

  it('検索モード中はPaginationが非表示になること', async () => {
    const { useKnowledgeSearch } = await import('@/feature/knowledge/hooks/useKnowledgeSearch');
    const mockSearch = vi.fn();
    vi.mocked(useKnowledgeSearch).mockReturnValue({
      results: [{ ...mockKnowledgeEntries[0], similarity: 0.9 }],
      isSearching: false,
      search: mockSearch,
    });

    render(<KnowledgeClient />);

    // 検索を実行
    const searchInput = screen.getByPlaceholderText(/検索/i);
    fireEvent.change(searchInput, { target: { value: 'テスト' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '15' })).not.toBeInTheDocument();
    });
  });
});
