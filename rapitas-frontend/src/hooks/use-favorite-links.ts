import useSWR from 'swr';
import { toast } from 'react-toastify';
import type { FavoriteLink, CreateFavoriteLinkData, UpdateFavoriteLinkData } from '@/types/favorite-link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export function useFavoriteLinks() {
  const { data, error, mutate, isLoading } = useSWR<FavoriteLink[]>(
    `${API_BASE}/favorite-links`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const createFavoriteLink = async (data: CreateFavoriteLinkData) => {
    try {
      const response = await fetch(`${API_BASE}/favorite-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to create favorite link');
      }

      const newLink = await response.json();
      toast.success('お気に入りリンクを追加しました');
      await mutate();
      return newLink;
    } catch (error) {
      console.error('Error creating favorite link:', error);
      toast.error('お気に入りリンクの追加に失敗しました');
      throw error;
    }
  };

  const updateFavoriteLink = async (id: number, data: UpdateFavoriteLinkData) => {
    try {
      const response = await fetch(`${API_BASE}/favorite-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to update favorite link');
      }

      const updatedLink = await response.json();
      toast.success('お気に入りリンクを更新しました');
      await mutate();
      return updatedLink;
    } catch (error) {
      console.error('Error updating favorite link:', error);
      toast.error('お気に入りリンクの更新に失敗しました');
      throw error;
    }
  };

  const deleteFavoriteLink = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/favorite-links/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete favorite link');
      }

      toast.success('お気に入りリンクを削除しました');
      await mutate();
    } catch (error) {
      console.error('Error deleting favorite link:', error);
      toast.error('お気に入りリンクの削除に失敗しました');
      throw error;
    }
  };

  const visitFavoriteLink = async (link: FavoriteLink) => {
    try {
      // Update visit stats
      const response = await fetch(`${API_BASE}/favorite-links/${link.id}/visit`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to update visit stats');
      }

      // Optimistically update the local data
      await mutate((currentData) => {
        if (!currentData) return currentData;
        return currentData.map((item) => {
          if (item.id === link.id) {
            return {
              ...item,
              visitCount: item.visitCount + 1,
              lastVisited: new Date().toISOString(),
            };
          }
          return item;
        });
      }, false); // false to skip revalidation since we're updating optimistically

      // Then revalidate in the background to get the actual server state
      mutate();
    } catch (error) {
      console.error('Error updating visit stats:', error);
    }
  };

  const reorderFavoriteLinks = async (links: Array<{ id: number; sortOrder: number }>) => {
    try {
      const response = await fetch(`${API_BASE}/favorite-links/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links }),
      });

      if (!response.ok) {
        throw new Error('Failed to reorder favorite links');
      }

      await mutate();
    } catch (error) {
      console.error('Error reordering favorite links:', error);
      toast.error('お気に入りリンクの並び替えに失敗しました');
      throw error;
    }
  };

  return {
    favoriteLinks: data || [],
    isLoading,
    error,
    createFavoriteLink,
    updateFavoriteLink,
    deleteFavoriteLink,
    visitFavoriteLink,
    reorderFavoriteLinks,
    mutate,
  };
}

export function useFavoriteLinksByCategory(category?: string) {
  const { data, error, mutate, isLoading } = useSWR<FavoriteLink[]>(
    category ? `${API_BASE}/favorite-links/category/${category}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return {
    favoriteLinks: data || [],
    isLoading,
    error,
    mutate,
  };
}

export function useFavoriteLinksSearch(query: string) {
  const { data, error, isLoading } = useSWR<FavoriteLink[]>(
    query ? `${API_BASE}/favorite-links/search?q=${encodeURIComponent(query)}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      keepPreviousData: true,
    }
  );

  return {
    searchResults: data || [],
    isSearching: isLoading,
    error,
  };
}