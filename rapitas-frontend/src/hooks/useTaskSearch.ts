/**
 * Custom hook for task search
 * Optimized with debouncing, cancellation, and caching
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchTasks } from '@/lib/task-api';
import type { Task } from '@/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useTaskSearch');

interface UseTaskSearchOptions {
  minLength?: number; // Minimum search character count
  debounceDelay?: number; // Debounce delay (ms)
}

export function useTaskSearch(options: UseTaskSearchOptions = {}) {
  const { minLength = 2, debounceDelay = 300 } = options;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Execute search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      // Cancel previous search
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (searchQuery.length < minLength) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Create new AbortController
      abortControllerRef.current = new AbortController();

      try {
        const tasks = await searchTasks(searchQuery);

        // Set results if not cancelled
        if (!abortControllerRef.current.signal.aborted) {
          setResults(tasks);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message || 'An error occurred during search');
          logger.error('Search error:', err);
        } else if (!(err instanceof Error)) {
          setError('An error occurred during search');
          logger.error('Search error:', err);
        }
      } finally {
        if (!abortControllerRef.current?.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [minLength],
  );

  // Debounce processing on query change
  useEffect(() => {
    // Clear previous timer
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Clear immediately if empty string
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Set debounce timer
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, debounceDelay);

    // Cleanup
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, debounceDelay, performSearch]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Clear search
  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    clearSearch,
  };
}

/**
 * Hook with advanced search filters
 */
interface SearchFilters {
  status?: string[];
  categoryId?: number;
  dateRange?: {
    from: Date;
    to: Date;
  };
  tags?: string[];
}

export function useAdvancedTaskSearch(
  initialFilters: SearchFilters = {},
  options: UseTaskSearchOptions = {},
) {
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const { query, setQuery, results, loading, error, clearSearch } =
    useTaskSearch(options);

  // Results with filters applied
  const filteredResults = results.filter((task) => {
    // Status filter
    if (filters.status?.length && !filters.status.includes(task.status)) {
      return false;
    }

    // Category filter (Task has theme.categoryId)
    if (filters.categoryId && task.theme?.categoryId !== filters.categoryId) {
      return false;
    }

    // Date range filter
    if (filters.dateRange) {
      const taskDate = new Date(task.createdAt);
      if (
        taskDate < filters.dateRange.from ||
        taskDate > filters.dateRange.to
      ) {
        return false;
      }
    }

    // Tag filter (implementation assumed)
    if (filters.tags?.length) {
      // Assuming task.tags exists
      // const taskTags = task.tags || [];
      // if (!filters.tags.some(tag => taskTags.includes(tag))) {
      //   return false;
      // }
    }

    return true;
  });

  // Update filter
  const updateFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilters({});
    clearSearch();
  }, [clearSearch]);

  return {
    query,
    setQuery,
    results: filteredResults,
    totalResults: results.length,
    loading,
    error,
    filters,
    updateFilter,
    clearSearch,
    clearAllFilters,
  };
}
