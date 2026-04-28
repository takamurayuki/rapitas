'use client';
// ErrorFilters

import React from 'react';
import { Card } from '@/components/ui/card';
import Button from '@/components/ui/button/Button';
import { Search, RefreshCw, Download } from 'lucide-react';
import { ErrorCategory, ErrorSeverity } from '../../services/error-analysis-service';

type ErrorFiltersProps = {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCategory: ErrorCategory | 'all';
  onCategoryChange: (value: ErrorCategory | 'all') => void;
  selectedSeverity: ErrorSeverity | 'all';
  onSeverityChange: (value: ErrorSeverity | 'all') => void;
  isAutoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onExport: () => void;
};

/**
 * Filter toolbar for the error list.
 *
 * @param props - See ErrorFiltersProps
 * @returns Card with search, filter selects, and action buttons.
 */
export function ErrorFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedSeverity,
  onSeverityChange,
  isAutoRefresh,
  onToggleAutoRefresh,
  onExport,
}: ErrorFiltersProps) {
  return (
    <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search errors..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value as ErrorCategory | 'all')}
          className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="all">All Categories</option>
          {Object.values(ErrorCategory).map((category) => (
            <option key={category} value={category}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={selectedSeverity}
          onChange={(e) => onSeverityChange(e.target.value as ErrorSeverity | 'all')}
          className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="all">All Severities</option>
          {Object.values(ErrorSeverity).map((severity) => (
            <option key={severity} value={severity}>
              {severity.charAt(0).toUpperCase() + severity.slice(1)}
            </option>
          ))}
        </select>

        <Button
          onClickAction={onToggleAutoRefresh}
          variant={isAutoRefresh ? 'primary' : 'secondary'}
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 ${isAutoRefresh ? 'animate-spin' : ''}`} />
        </Button>

        <Button onClickAction={onExport} variant="secondary" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export Log
        </Button>
      </div>
    </Card>
  );
}
