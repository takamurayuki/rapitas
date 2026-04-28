'use client';

/**
 * daily-schedule/_components/useScheduleBlocks
 *
 * Custom hook that owns fetch / CRUD state for DailyScheduleBlock records
 * and the notification timer. Not responsible for any UI rendering.
 */

import { useState, useCallback, useEffect } from 'react';
import type { DailyScheduleBlock } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { requestNotificationPermission, showDesktopNotification } from '@/utils/notification';
import { createLogger } from '@/lib/logger';
import { CATEGORY_OPTIONS } from './schedule-utils';

const logger = createLogger('useScheduleBlocks');

export type BlockFormData = {
  label: string;
  startTime: string;
  endTime: string;
  color: string;
  category: string;
  isNotify: boolean;
};

const DEFAULT_FORM: BlockFormData = {
  label: '',
  startTime: '07:00',
  endTime: '08:00',
  color: '#3B82F6',
  category: 'other',
  isNotify: false,
};

export type UseScheduleBlocksReturn = {
  blocks: DailyScheduleBlock[];
  loading: boolean;
  isModalOpen: boolean;
  editingBlock: DailyScheduleBlock | null;
  formData: BlockFormData;
  setFormData: React.Dispatch<React.SetStateAction<BlockFormData>>;
  openCreateModal: () => void;
  openEditModal: (block: DailyScheduleBlock) => void;
  closeModal: () => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleDelete: (id: number) => Promise<void>;
  handleCategoryChange: (category: string) => void;
};

/**
 * Manages all schedule block data and modal state for the daily-schedule page.
 *
 * @param t - Translations function from useTranslations('habits') / 翻訳関数
 * @returns All state and handlers for schedule block CRUD / 全状態とハンドラ
 */
export function useScheduleBlocks(
  t: (key: string, values?: Record<string, string | number>) => string,
): UseScheduleBlocksReturn {
  const [blocks, setBlocks] = useState<DailyScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<DailyScheduleBlock | null>(null);
  const [formData, setFormData] = useState<BlockFormData>(DEFAULT_FORM);

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/daily-schedule`);
      if (res.ok) {
        setBlocks(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch schedule blocks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // Notification timer — fires every 30 s and matches block start times.
  useEffect(() => {
    if (blocks.length === 0) return;

    requestNotificationPermission();

    const checkNotifications = () => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      for (const block of blocks) {
        if (!block.isNotify) continue;
        if (block.startTime === currentTime) {
          const cat = CATEGORY_OPTIONS.find((c) => c.value === block.category);
          showDesktopNotification(`Rapitas - ${block.label}`, {
            body: `${block.startTime}〜${block.endTime} ${cat ? t(cat.labelKey) : ''}`,
            tag: `daily-schedule-${block.id}-${currentTime}`,
          });
        }
      }
    };

    // Check every 30 seconds
    const interval = setInterval(checkNotifications, 30_000);
    checkNotifications();

    return () => clearInterval(interval);
  }, [blocks, t]);

  const openCreateModal = () => {
    setEditingBlock(null);
    setFormData(DEFAULT_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (block: DailyScheduleBlock) => {
    setEditingBlock(block);
    setFormData({
      label: block.label,
      startTime: block.startTime,
      endTime: block.endTime,
      color: block.color,
      category: block.category,
      isNotify: block.isNotify,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.label.trim()) return;

    try {
      const url = editingBlock
        ? `${API_BASE_URL}/daily-schedule/${editingBlock.id}`
        : `${API_BASE_URL}/daily-schedule`;
      const method = editingBlock ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: formData.label.trim(),
          startTime: formData.startTime,
          endTime: formData.endTime,
          color: formData.color,
          category: formData.category,
          isNotify: formData.isNotify,
        }),
      });

      if (res.ok) {
        fetchBlocks();
        setIsModalOpen(false);
      }
    } catch (e) {
      logger.error('Failed to save schedule block:', e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('confirmDeleteBlock'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/daily-schedule/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchBlocks();
      }
    } catch (e) {
      logger.error('Failed to delete schedule block:', e);
    }
  };

  const handleCategoryChange = (category: string) => {
    const cat = CATEGORY_OPTIONS.find((c) => c.value === category);
    setFormData((prev) => ({
      ...prev,
      category,
      color: cat?.defaultColor || prev.color,
    }));
  };

  return {
    blocks,
    loading,
    isModalOpen,
    editingBlock,
    formData,
    setFormData,
    openCreateModal,
    openEditModal,
    closeModal,
    handleSubmit,
    handleDelete,
    handleCategoryChange,
  };
}
