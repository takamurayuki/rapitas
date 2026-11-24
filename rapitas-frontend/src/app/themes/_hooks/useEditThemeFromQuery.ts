'use client';
/**
 * useEditThemeFromQuery
 *
 * Opens the theme named by `?edit=<id>` on the theme list, once, after the
 * themes and categories have loaded. Not responsible for the edit form itself.
 */
import { useEffect, useRef } from 'react';
import type { Category, Theme } from '@/types';

interface Options {
  /** Loaded themes; empty while loading. */
  items: Theme[];
  /** Loaded categories; empty while loading. */
  categories: Category[];
  /** Opens a theme in the inline edit form. */
  startEdit: (theme: Theme) => void;
  /** Switches the visible category tab. */
  setSelectedCategoryId: (id: number | null) => void;
}

/**
 * Open `?edit=<id>`'s theme for editing.
 *
 * NOTE: Notifications and the execution-capability guide link here with
 * `?edit=<id>`; the page used to ignore the parameter (2026-11-24). It reads
 * `window.location` rather than `useSearchParams`, which needs a Suspense
 * boundary under the desktop build's static export.
 *
 * @param options - Loaded data and the page's edit handlers / 読み込み済みデータと編集ハンドラ
 */
export function useEditThemeFromQuery({
  items,
  categories,
  startEdit,
  setSelectedCategoryId,
}: Options): void {
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current || items.length === 0 || categories.length === 0) return;
    handledRef.current = true;
    const raw = new URLSearchParams(window.location.search).get('edit');
    const id = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    const theme = id === null ? undefined : items.find((t) => t.id === id);
    if (!theme) return;
    // The list shows one category at a time; the fetch that picks the first
    // category has already run by now, so this choice is not overwritten.
    if (theme.categoryId != null) setSelectedCategoryId(theme.categoryId);
    startEdit(theme);
  }, [items, categories, startEdit, setSelectedCategoryId]);
}
