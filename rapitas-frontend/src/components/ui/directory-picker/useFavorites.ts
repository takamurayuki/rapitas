'use client';

/**
 * directory-picker/useFavorites
 *
 * Custom hook that manages the favorites list state and API calls.
 * Extracted from useDirectoryPicker to keep individual files under 300 lines.
 * Not responsible for any UI rendering.
 */

import { useState, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { FavoriteDirectory } from './types';

const logger = createLogger('useFavorites');

export type UseFavoritesReturn = {
  favorites: FavoriteDirectory[];
  isLoadingFavorites: boolean;
  fetchFavorites: () => Promise<FavoriteDirectory[] | null>;
  addToFavorites: (path: string) => Promise<void>;
  removeFromFavorites: (id: number) => Promise<void>;
  isFavorite: (path: string) => boolean;
  getFavoriteId: (path: string) => number | undefined;
  setFavorites: React.Dispatch<React.SetStateAction<FavoriteDirectory[]>>;
};

/**
 * Manages the favorites list for the directory picker.
 * Fetches favorites on mount and exposes add/remove operations.
 *
 * @returns Favorites state and CRUD handlers / お気に入り状態とCRUDハンドラ
 */
export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<FavoriteDirectory[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);

  useEffect(() => {
    fetchFavorites();
  }, []);

  const fetchFavorites = async (): Promise<FavoriteDirectory[] | null> => {
    setIsLoadingFavorites(true);
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites`);
      const data = await res.json();
      if (!data.error) {
        setFavorites(data);
        return data as FavoriteDirectory[];
      }
      return null;
    } catch (err) {
      logger.error('Failed to fetch favorites:', err);
      return null;
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  const addToFavorites = async (dirPath: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (!data.error) {
        setFavorites((prev) => [data, ...prev]);
      }
    } catch (err) {
      logger.error('Failed to add favorite:', err);
    }
  };

  const removeFromFavorites = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setFavorites((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (err) {
      logger.error('Failed to remove favorite:', err);
    }
  };

  const isFavorite = (dirPath: string) => favorites.some((f) => f.path === dirPath);

  const getFavoriteId = (dirPath: string) => favorites.find((f) => f.path === dirPath)?.id;

  return {
    favorites,
    isLoadingFavorites,
    fetchFavorites,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    getFavoriteId,
    setFavorites,
  };
}
