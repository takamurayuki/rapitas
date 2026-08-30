'use client';

/**
 * usePhaseTimeline
 *
 * Fetches the confirmed phase-timeline data (task #785) for a task from
 * `GET /workflow/tasks/:taskId/phase-timeline` and caches it per taskId so
 * repeated mounts of PhaseTimeline for the same task don't refetch. NOT
 * responsible for live-tail merging — see usePhaseLogStreaming for that.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { PhaseType } from '../utils/phase-selector';

export type PhaseRunStatus = 'running' | 'completed' | 'failed';

export interface PhaseIterationSummary {
  status: PhaseRunStatus;
  durationMs: number | null;
  logLineCount: number;
  testPass: number | null;
  testFail: number | null;
}

export interface PhaseIteration {
  iterationNumber: number;
  executionIds: number[];
  startedAt: string | null;
  completedAt: string | null;
  status: PhaseRunStatus;
  logLineCount: number;
  boundaryUncertain: boolean;
  summary: PhaseIterationSummary;
}

export interface PhaseSegment {
  phaseType: PhaseType;
  iterations: PhaseIteration[];
}

export type WorkflowTimelineMode = 'lightweight' | 'standard' | 'comprehensive';

interface PhaseTimelineResponse {
  success: boolean;
  phases?: PhaseSegment[];
  workflowMode?: WorkflowTimelineMode;
  error?: string;
}

export interface UsePhaseTimelineResult {
  phases: PhaseSegment[];
  workflowMode: WorkflowTimelineMode | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Module-level cache keyed by taskId — repeated mounts (e.g. re-expanding the
// execution section) reuse the last successful fetch instead of re-hitting
// the API immediately; refetch() (called on poll ticks while running) always
// bypasses it.
const cache = new Map<number, { phases: PhaseSegment[]; workflowMode: WorkflowTimelineMode }>();

/**
 * Loads and caches the phase-timeline for one task.
 *
 * @param taskId - Task whose phase timeline to fetch / タスクID
 * @returns Phase segments, workflow mode, and loading/error state / タイムラインの状態
 */
export function usePhaseTimeline(taskId: number): UsePhaseTimelineResult {
  const cached = cache.get(taskId);
  const [phases, setPhases] = useState<PhaseSegment[]>(cached?.phases ?? []);
  const [workflowMode, setWorkflowMode] = useState<WorkflowTimelineMode | null>(
    cached?.workflowMode ?? null,
  );
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const taskIdRef = useRef(taskId);

  const fetchTimeline = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/phase-timeline`);
      const data = (await res.json()) as PhaseTimelineResponse;
      if (!res.ok || !data.success || !data.phases || !data.workflowMode) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      cache.set(taskId, { phases: data.phases, workflowMode: data.workflowMode });
      setPhases(data.phases);
      setWorkflowMode(data.workflowMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    // Task changed — drop the previous task's state before fetching so the
    // consumer never briefly renders phase B's data under taskId A.
    if (taskIdRef.current !== taskId) {
      taskIdRef.current = taskId;
      const next = cache.get(taskId);
      setPhases(next?.phases ?? []);
      setWorkflowMode(next?.workflowMode ?? null);
      setLoading(!next);
    }
    void fetchTimeline();
  }, [taskId, fetchTimeline]);

  return { phases, workflowMode, loading, error, refetch: fetchTimeline };
}
