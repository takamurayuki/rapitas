/**
 * Custom hook for search filter management
 * Provides add/remove/clear operations for active filters
 */

import { useState, useCallback, useMemo } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useSearchFilters');

export interface SearchFilter {
  id: string;
  type: 'status' | 'date_range' | 'category' | 'priority';
  label: string;
  value: string | { from: string; to: string };
}

export function useSearchFilters(initialFilters: SearchFilter[] = []) {
  const [filters, setFilters] = useState<SearchFilter[]>(initialFilters);

  const addFilter = useCallback((filter: SearchFilter) => {
    setFilters((prev) => {
      // Replace if filter with same ID already exists
      const exists = prev.some((f) => f.id === filter.id);
      if (exists) {
        logger.warn(`Filter "${filter.id}" already exists, replacing`);
        return prev.map((f) => (f.id === filter.id ? filter : f));
      }
      return [...prev, filter];
    });
  }, []);

  const removeFilter = useCallback((filterId: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters([]);
  }, []);

  const hasActiveFilters = useMemo(() => filters.length > 0, [filters]);

  const getFiltersByType = useCallback(
    (type: SearchFilter['type']) => filters.filter((f) => f.type === type),
    [filters],
  );

  return {
    filters,
    addFilter,
    removeFilter,
    clearFilters,
    hasActiveFilters,
    getFiltersByType,
  };
}
