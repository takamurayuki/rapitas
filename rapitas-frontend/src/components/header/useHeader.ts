'use client';
/**
 * header/useHeader.ts
 *
 * Custom hook that owns all state and side-effects for the Header component.
 * Separates business logic from presentation so each sub-component stays thin.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useDarkMode } from '@/hooks/useDarkMode';
import { isTauri } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { useShortcutStore, type ShortcutId } from '@/stores/shortcut-store';
import { useAppModeStore } from '@/stores/app-mode-store';
import { useNoteStore } from '@/stores/note-store';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';
import { checkIsTaskDetailPage } from './types';
import { useClickOutside } from './useClickOutside';
import type { AppMode } from '@/stores/app-mode-store';

/** All state and callbacks surfaced to Header sub-components. */
export type UseHeaderReturn = {
  pathname: string | null;
  router: ReturnType<typeof useRouter>;
  hideHeader: boolean;
  showHeader: boolean;
  isTaskDetailPage: boolean;
  isMenuOpen: boolean;
  setIsMenuOpen: (v: boolean) => void;
  isMenuPinned: boolean;
  setIsMenuPinned: (v: boolean) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  expandedItems: Set<string>;
  toggleExpand: (label: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  debounceTimerRef: React.RefObject<NodeJS.Timeout | null>;
  isTauriEnv: boolean;
  hasMounted: boolean;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: (v: boolean) => void;
  moreMenuRef: React.RefObject<HTMLDivElement | null>;
  isUserMenuOpen: boolean;
  setIsUserMenuOpen: (v: boolean) => void;
  userMenuRef: React.RefObject<HTMLDivElement | null>;
  isRestarting: boolean;
  restartConfirmDialog: { open: boolean; activeExecutions: number };
  setRestartConfirmDialog: (v: { open: boolean; activeExecutions: number }) => void;
  handleRestartClick: () => Promise<void>;
  executeRestart: () => Promise<void>;
  user: ReturnType<typeof useAuth>['user'];
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  handleLogout: () => Promise<void>;
  isDarkMode: boolean;
  darkModeMounted: boolean;
  toggleTheme: () => void;
  getShortcutLabel: (id: ShortcutId) => string | undefined;
  appMode: AppMode;
  modalState: { isOpen: boolean; activeTab: string };
  openModal: () => void;
  closeModal: () => void;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
};

/**
 * Encapsulates all Header state, derived values, and event handlers.
 *
 * @returns UseHeaderReturn object consumed by Header sub-components
 */
export function useHeader(): UseHeaderReturn {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hideHeader = searchParams.get('hideHeader') === 'true';
  const showHeader = searchParams.get('showHeader') === 'true';

  // NOTE: Also checks window.location.pathname to handle iframe embedding where Next.js pathname may differ.
  const [isTaskDetailPage, setIsTaskDetailPage] = useState(() => checkIsTaskDetailPage(pathname));
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuPinned, setIsMenuPinned] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartConfirmDialog, setRestartConfirmDialog] = useState<{
    open: boolean;
    activeExecutions: number;
  }>({ open: false, activeExecutions: 0 });
  const [hasMounted, setHasMounted] = useState(false);

  const { isDarkMode, mounted: darkModeMounted, toggleTheme } = useDarkMode();
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();

  const menuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isUpdatingSearchRef = useRef(false);

  const shortcutBindings = useShortcutStore((state) => state.shortcuts);
  const appMode = useAppModeStore((state) => state.mode);
  const { modalState, openModal, closeModal } = useNoteStore();
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  // Click-outside handlers — stable references required by useClickOutside dep array
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  const closeMoreMenu = useCallback(() => setIsMoreMenuOpen(false), []);
  const closeUserMenu = useCallback(() => setIsUserMenuOpen(false), []);

  // NOTE: Side nav click-outside also checks isMenuPinned; pinned menu must not auto-close.
  useClickOutside(
    menuRef,
    useCallback(() => {
      if (!isMenuPinned) setIsMenuOpen(false);
    }, [isMenuPinned]),
    isMenuOpen,
  );
  useClickOutside(moreMenuRef, closeMoreMenu, isMoreMenuOpen);
  useClickOutside(userMenuRef, closeUserMenu, isUserMenuOpen);

  /**
   * Converts a shortcut binding id into a displayable key combination string.
   *
   * @param id - ShortcutId to look up / 検索するShortcutId
   * @returns Formatted key string or undefined if not found / フォーマットされたキー文字列またはundefined
   */
  const getShortcutLabel = (id: ShortcutId): string | undefined => {
    const binding = shortcutBindings.find((s) => s.id === id);
    if (!binding) return undefined;
    const parts: string[] = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.meta) parts.push('\u2318');
    if (binding.shift) parts.push('\u21E7');
    parts.push(binding.key ? binding.key.toUpperCase() : '');
    return parts.join('');
  };

  /**
   * Fires the restart API call and polls until the server is back up.
   */
  const executeRestart = async () => {
    setIsRestarting(true);
    setRestartConfirmDialog({ open: false, activeExecutions: 0 });
    setIsMoreMenuOpen(false);
    try {
      await fetch(`${API_BASE_URL}/agents/restart`, { method: 'POST' });
    } catch {
      // NOTE: Connection error is expected because the restart kills the server process.
    }
    const waitForServer = async () => {
      const maxAttempts = 30;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch(`${API_BASE_URL}/agents/system-status`);
          if (res.ok) {
            window.location.reload();
            return;
          }
        } catch {}
      }
      setIsRestarting(false);
      alert(t('restartTimeout'));
    };
    waitForServer();
  };

  /**
   * Checks for active agent executions before restarting; shows confirmation if any are running.
   */
  const handleRestartClick = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/system-status`);
      if (!res.ok) throw new Error('Failed to fetch system status');
      const status = await res.json();
      const activeCount = (status.activeExecutions || 0) + (status.runningExecutions || 0);
      if (activeCount > 0) {
        setRestartConfirmDialog({ open: true, activeExecutions: activeCount });
      } else {
        executeRestart();
      }
    } catch {
      executeRestart();
    }
  };

  /** Logs the current user out and redirects to the login page. */
  const handleLogout = async () => {
    setIsUserMenuOpen(false);
    await logout();
    router.push('/auth/login');
  };

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      return newSet;
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      isUpdatingSearchRef.current = true;
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  // Mount guards
  useEffect(() => {
    setHasMounted(true);
  }, []);
  useEffect(() => {
    setIsTauriEnv(isTauri());
  }, []);

  useEffect(() => {
    const windowPath = window.location.pathname;
    const isDetail = checkIsTaskDetailPage(pathname) || checkIsTaskDetailPage(windowPath);
    setIsTaskDetailPage(isDetail);
  }, [pathname]);

  // Persist menu pin state
  useEffect(() => {
    const savedPinned = localStorage.getItem('menuPinned');
    if (savedPinned === 'true') {
      setIsMenuPinned(true);
      setIsMenuOpen(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('menuPinned', isMenuPinned.toString());
  }, [isMenuPinned]);

  // Debounced search → URL sync
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (pathname === '/' || pathname === '/kanban' || pathname === '/ideas') {
      debounceTimerRef.current = setTimeout(() => {
        isUpdatingSearchRef.current = true;
        // Preserve original behavior: '/' and '/kanban' both write into '/?search=...';
        // '/ideas' keeps its own URL.
        const targetPath = pathname === '/ideas' ? '/ideas' : '/';
        if (searchQuery.trim()) {
          router.push(`${targetPath}?search=${encodeURIComponent(searchQuery.trim())}`);
        } else {
          const currentSearch = searchParams.get('search');
          if (currentSearch) router.push(pathname);
        }
      }, 300);
    }

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, pathname, router]);

  // URL → search box sync
  useEffect(() => {
    if (isUpdatingSearchRef.current) {
      isUpdatingSearchRef.current = false;
      return;
    }

    if (pathname === '/search') {
      const q = searchParams.get('q');
      if (q && searchQuery !== q) setSearchQuery(q);
    } else {
      const search = searchParams.get('search');
      if (search && searchQuery !== search) setSearchQuery(search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pathname]);

  return {
    pathname,
    router,
    hideHeader,
    showHeader,
    isTaskDetailPage,
    isMenuOpen,
    setIsMenuOpen,
    isMenuPinned,
    setIsMenuPinned,
    menuRef,
    expandedItems,
    toggleExpand,
    searchQuery,
    setSearchQuery,
    handleSearchKeyDown,
    debounceTimerRef,
    isTauriEnv,
    hasMounted,
    isMoreMenuOpen,
    setIsMoreMenuOpen,
    moreMenuRef,
    isUserMenuOpen,
    setIsUserMenuOpen,
    userMenuRef,
    isRestarting,
    restartConfirmDialog,
    setRestartConfirmDialog,
    handleRestartClick,
    executeRestart,
    user,
    isAuthenticated,
    isAuthLoading,
    handleLogout,
    isDarkMode,
    darkModeMounted,
    toggleTheme,
    getShortcutLabel,
    appMode,
    modalState,
    openModal,
    closeModal,
    t,
    tc,
  };
}
