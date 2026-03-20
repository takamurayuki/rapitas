/**
 * useOrchestraState
 *
 * Custom hook managing Orchestra page state: fetching status/queue data,
 * establishing an SSE connection with exponential-backoff reconnection,
 * polling fallback, and all action handlers (start, stop, resume, enqueue,
 * cancel). Does not own any UI rendering.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type {
  OrchestraState,
  QueueState,
  AvailableTask,
} from './types';

/**
 * Manages all Orchestra page async state, SSE subscription, and CRUD actions.
 *
 * @returns State values and action handlers for use by OrchestraPage
 */
export function useOrchestraState() {
  const [state, setState] = useState<OrchestraState | null>(null);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    running: true,
    queued: true,
    waitingApproval: true,
    completed: false,
    failed: false,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, queueRes] = await Promise.all([
        fetch(`${API_BASE_URL}/workflow/orchestra/status`),
        fetch(`${API_BASE_URL}/workflow/orchestra/queue`),
      ]);
      if (stateRes.ok) setState(await stateRes.json());
      if (queueRes.ok) setQueueState(await queueRes.json());
    } catch (err) {
      console.error('Failed to fetch orchestra state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pollInterval: ReturnType<typeof setInterval> = setInterval(
      fetchState,
      10000,
    );

    const connectSSE = () => {
      const es = new EventSource(`${API_BASE_URL}/workflow/orchestra/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        reconnectAttempts = 0; // Reset on successful connection
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.state) {
            setState(data.state);
          }
          if (
            data.type === 'item_update' ||
            data.type?.startsWith('orchestra_')
          ) {
            fetchState();
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          // NOTE: Exponential backoff capped at 10 seconds to avoid long gaps
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts - 1),
            10000,
          );
          reconnectTimer = setTimeout(() => {
            connectSSE();
          }, delay);
        }
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      clearInterval(pollInterval);
    };
  }, [fetchState]);

  const startOrchestra = async () => {
    if (selectedTaskIds.length === 0) {
      setShowAddDialog(true);
      return;
    }
    setActionLoading('start');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: selectedTaskIds, maxConcurrency: 3 }),
      });
      setSelectedTaskIds([]);
      setShowAddDialog(false);
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const stopOrchestra = async () => {
    setActionLoading('stop');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/stop`, {
        method: 'POST',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const resumeOrchestra = async () => {
    setActionLoading('resume');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/resume`, {
        method: 'POST',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const enqueueTask = async (taskId: number) => {
    setActionLoading(`enqueue-${taskId}`);
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const cancelItem = async (itemId: number) => {
    setActionLoading(`cancel-${itemId}`);
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/queue/${itemId}`, {
        method: 'DELETE',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const fetchAvailableTasks = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks?status=todo,in-progress&limit=50`,
      );
      if (res.ok) {
        const data = await res.json();
        setAvailableTasks(Array.isArray(data) ? data : data.tasks || []);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectTask = (taskId: number, checked: boolean) => {
    setSelectedTaskIds((prev) =>
      checked ? [...prev, taskId] : prev.filter((id) => id !== taskId),
    );
  };

  const handleEnqueueSelected = async () => {
    for (const id of selectedTaskIds) {
      await enqueueTask(id);
    }
    setShowAddDialog(false);
    setSelectedTaskIds([]);
  };

  const openAddDialog = () => {
    fetchAvailableTasks();
    setShowAddDialog(true);
  };

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setSelectedTaskIds([]);
  };

  return {
    state,
    queueState,
    loading,
    actionLoading,
    showAddDialog,
    availableTasks,
    selectedTaskIds,
    expandedSections,
    startOrchestra,
    stopOrchestra,
    resumeOrchestra,
    cancelItem,
    toggleSection,
    handleSelectTask,
    handleEnqueueSelected,
    openAddDialog,
    closeAddDialog,
  };
}
