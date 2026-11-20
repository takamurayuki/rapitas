import { useMemo } from 'react';
import type { Task } from '@/types';

interface UseTaskSortingProps {
  tasks: Task[];
  sortBy: 'createdAt' | 'priority' | 'title' | 'dueDate';
  sortOrder: 'asc' | 'desc';
}

export function useTaskSorting({ tasks, sortBy, sortOrder }: UseTaskSortingProps): Task[] {
  return useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'dueDate') {
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : NaN;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : NaN;
        const aMissing = Number.isNaN(aTime);
        const bMissing = Number.isNaN(bTime);
        // Tasks without a due date stay last in both directions, so this must run before the sign flip below.
        if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
        comparison = aTime - bTime;
        return sortOrder === 'asc' ? comparison : -comparison;
      }

      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'priority':
          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          comparison =
            (priorityOrder[a.priority as keyof typeof priorityOrder] || 0) -
            (priorityOrder[b.priority as keyof typeof priorityOrder] || 0);
          break;
        case 'createdAt':
        default:
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [tasks, sortBy, sortOrder]);
}
