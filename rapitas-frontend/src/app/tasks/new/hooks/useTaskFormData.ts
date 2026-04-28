'use client';
// useTaskFormData
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Theme, UserSettings, Category } from '@/types';
import { useAppModeStore } from '@/stores/app-mode-store';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useTaskFormData');
const API_BASE = API_BASE_URL;

interface UseTaskFormDataOptions {
  /** Current theme ID; used to compute selectedTheme. */
  themeId: number | null;
  /** Setter so this hook can pre-select a default or URL-param theme. */
  setThemeId: (id: number | null) => void;
}

/**
 * Loads themes, categories, and global settings on mount.
 * Applies the default theme when no themeId URL param is present.
 *
 * @param options.themeId - Currently selected theme ID / 選択中テーマID
 * @param options.setThemeId - Setter from the parent form state / 親フォームのthemeIdセッター
 * @returns Remote data and derived theme helpers.
 */
export function useTaskFormData({ themeId, setThemeId }: UseTaskFormDataOptions) {
  const searchParams = useSearchParams();
  const appMode = useAppModeStore((state) => state.mode);

  const [themes, setThemes] = useState<Theme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(null);

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      if (res.ok) {
        setCategories(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch categories:', e);
    }
  };

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${API_BASE}/themes`);
      const data = await res.json();
      setThemes(data);
      const themeIdParam = searchParams.get('themeId');
      if (!themeIdParam) {
        const defaultTheme = data.find((theme: Theme) => theme.isDefault);
        if (defaultTheme) {
          setThemeId(defaultTheme.id);
        }
      }
    } catch (e) {
      logger.error(e);
    }
  };

  // NOTE: initializedRef prevents double-fetch in React StrictMode double-invoke.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const themeIdParam = searchParams.get('themeId');
    if (themeIdParam) {
      setThemeId(Number(themeIdParam));
    }
    fetchThemes();
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchGlobalSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const settings = await res.json();
          logger.debug('[useTaskFormData] Fetched settings:', settings);
          setGlobalSettings(settings);
        }
      } catch (e) {
        logger.error('Failed to fetch global settings:', e);
      }
    };
    fetchGlobalSettings();
  }, []);

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === themeId) || null,
    [themes, themeId],
  );

  /**
   * Themes filtered by current app mode and optional themeId URL param.
   *
   * @returns Visible theme list / 表示可能なテーマリスト
   */
  const visibleThemes = useMemo(() => {
    const themeIdParam = searchParams.get('themeId');
    const visibleCategoryIds = new Set(
      categories
        .filter((cat) => {
          if (appMode === 'all') return true;
          if (cat.mode === 'both') return true;
          return cat.mode === appMode;
        })
        .map((cat) => cat.id),
    );
    if (themeIdParam) {
      return themes.filter((theme) => theme.id === Number(themeIdParam));
    }
    return themes.filter((theme) => {
      if (!theme.categoryId) return true;
      return visibleCategoryIds.has(theme.categoryId);
    });
  }, [themes, categories, appMode, searchParams]);

  return { themes, categories, globalSettings, selectedTheme, visibleThemes };
}
