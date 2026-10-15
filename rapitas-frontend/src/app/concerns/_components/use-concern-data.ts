/**
 * useConcernData
 *
 * Owns the concern list itself: fetching, filters, pagination, GitHub publish
 * targets, and the list/bridge mutations (convert-to-task / delete / publish).
 * Holds no add-form state.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useToast } from '@/components/ui/toast/ToastContainer';
import {
  type Concern,
  type ConcernSeverity,
  type ConcernStatus,
  type ConcernType,
  type GhIntegration,
} from './concern-shared';

/**
 * Provide the concern list view model.
 *
 * @returns List data, filter/pagination state, and the convert/delete/publish
 *   handlers. / 一覧データ・フィルタ/ページネーション状態と変換/削除/公開ハンドラ。
 */
export function useConcernData() {
  const t = useTranslations('concerns');
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ConcernStatus | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<ConcernType | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<ConcernSeverity | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all');
  const [themeFilter, setThemeFilter] = useState<number | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  // GitHub integrations available as publish targets (empty = no repos linked).
  const [integrations, setIntegrations] = useState<GhIntegration[]>([]);

  const { themes } = useFilterDataStore();
  const { showToast } = useToast();
  // Concerns publish to a theme's repo, so only themes with a working directory
  // are selectable. (Shared rule with the idea box.)
  const workingDirThemes = themes.filter((t) => t.workingDirectory);
  // Theme lookup for the per-card theme-name badge.
  const themeById = new Map(themes.map((t) => [t.id, t]));

  const totalPages = Math.ceil(total / itemsPerPage);

  const fetchConcerns = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (severityFilter !== 'all') params.set('severity', severityFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (themeFilter !== 'all') params.set('themeId', String(themeFilter));
      const res = await fetch(`${API_BASE_URL}/concerns?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { concerns: Concern[]; total: number };
        setConcerns(data.concerns);
        setTotal(data.total);
      }
    } catch {
      /* non-fatal */
    } finally {
      setIsLoading(false);
    }
  }, [
    statusFilter,
    typeFilter,
    severityFilter,
    sourceFilter,
    themeFilter,
    currentPage,
    itemsPerPage,
  ]);

  useEffect(() => {
    fetchConcerns();
  }, [fetchConcerns]);

  // Load publish targets once; failure just hides the publish button.
  useEffect(() => {
    fetch(`${API_BASE_URL}/github/integrations`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GhIntegration[]) => setIntegrations(Array.isArray(data) ? data : []))
      .catch(() => setIntegrations([]));
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter, severityFilter, sourceFilter, themeFilter]);

  const handleConvert = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetch(`${API_BASE_URL}/concerns/${id}/convert-to-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          await fetchConcerns();
        } else {
          showToast(t('messages.convertFailed'), 'error');
        }
      } catch {
        showToast(t('messages.convertFailed'), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [fetchConcerns, showToast, t],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetch(`${API_BASE_URL}/concerns/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setConcerns((prev) => prev.filter((c) => c.id !== id));
          setTotal((prevTotal) => Math.max(0, prevTotal - 1));
        } else {
          showToast(t('messages.deleteFailed'), 'error');
        }
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [showToast, t],
  );

  const handlePublish = useCallback(
    async (id: number): Promise<void> => {
      setBusyId(id);
      try {
        // One click: no integrationId — the server resolves the repo from the
        // concern's theme and creates the issue directly.
        const res = await fetch(`${API_BASE_URL}/github/concerns/${id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          showToast(t('messages.publishSuccess'), 'success');
          await fetchConcerns();
          return;
        }
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(data?.error || t('messages.publishFailed'), 'error');
      } catch {
        showToast(t('messages.publishFailed'), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [fetchConcerns, showToast, t],
  );

  return {
    fetchConcerns,
    concerns,
    isLoading,
    busyId,
    canPublish: integrations.length > 0,
    themeById,
    workingDirThemes,
    statusFilter,
    setStatusFilter,
    typeFilter,
    setTypeFilter,
    severityFilter,
    setSeverityFilter,
    sourceFilter,
    setSourceFilter,
    themeFilter,
    setThemeFilter,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    totalPages,
    handleConvert,
    handleDelete,
    handlePublish,
  };
}
