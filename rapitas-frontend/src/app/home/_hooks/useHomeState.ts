'use client';
// useHomeState
import { useState, useRef } from 'react';
import type { Priority } from '@/types';
import { useLocalStorageState } from '@/hooks/common/useLocalStorageState';

/**
 * All local UI state for the home page view.
 *
 * @returns UI state values and their setters grouped by concern.
 */
export function useHomeState() {
  // --- Filter state ---
  const [filter, setFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useLocalStorageState<
    number | null
  >('selectedCategoryFilter', null);
  const [themeFilter, setThemeFilter] = useLocalStorageState<number | null>(
    'selectedThemeFilter',
    null,
  );
  const [priorityFilter, setPriorityFilter] = useState<Priority | null>(null);
  const [isFilterExpanded, setIsFilterExpanded] = useLocalStorageState<boolean>(
    'isFilterExpanded',
    false,
  );

  // --- Sort state ---
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority' | 'title'>(
    'createdAt',
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // --- Pagination state ---
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // --- Task panel state ---
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // --- Quick-add state ---
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState('');

  // --- Bulk selection state ---
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // --- Refs ---
  const progressRingRef = useRef<HTMLDivElement>(null);

  return {
    // Filter
    filter,
    setFilter,
    categoryFilter,
    setCategoryFilter,
    themeFilter,
    setThemeFilter,
    priorityFilter,
    setPriorityFilter,
    isFilterExpanded,
    setIsFilterExpanded,

    // Sort
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,

    // Pagination
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,

    // Panel
    selectedTaskId,
    setSelectedTaskId,
    isPanelOpen,
    setIsPanelOpen,

    // Quick-add
    isQuickAdding,
    setIsQuickAdding,
    quickTaskTitle,
    setQuickTaskTitle,

    // Bulk selection
    selectedTasks,
    setSelectedTasks,
    isSelectionMode,
    setIsSelectionMode,

    // Refs
    progressRingRef,
  };
}
