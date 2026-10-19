'use client';
/**
 * useRapiAvatarState
 *
 * Collects what the avatar needs from the app and hands it to
 * `resolveAvatarState`, which decides what that means.
 *
 * Mostly event-driven. `phase_transition` carries rapitas's `workflowStatus`
 * for the task that moved, which is exactly the ladder the avatar's states
 * map onto, so no polling is needed to follow a run. `/health` is read on
 * mount and then slowly, only to seed the execution count and to recover if
 * the stream drops — this component sits on every page, so it must not add
 * a busy poller.
 *
 * Not responsible for the rules themselves — see `rapi-avatar-state.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sharedEventSource } from '@/lib/sse/shared-event-source';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import {
  applyPhase,
  resolveAvatarState,
  DONE_HOLD_MS,
  ERROR_HOLD_MS,
  type AvatarSignals,
  type ResolvedAvatar,
} from './rapi-avatar-state';

const logger = createLogger('rapi-avatar');

/**
 * How often `/health` is re-read. Long on purpose: the stream is what keeps
 * the avatar current, and this only has to catch a dropped connection.
 */
const HEALTH_POLL_MS = 30_000;

/** The shape `/health` gives us, narrowed to what the avatar uses. */
interface HealthPayload {
  activeExecutions?: number;
}

/** A `phase_transition` payload, narrowed to what the avatar uses. */
interface PhaseEvent {
  taskId?: number;
  newPhase?: string;
}

/**
 * Follow rapitas and report what the avatar should be showing.
 *
 * @returns The current state and comet count / 表示状態と彗星の数
 */
export function useRapiAvatarState(): ResolvedAvatar {
  const [signals, setSignals] = useState<AvatarSignals>({
    phases: {},
    errorAt: null,
    doneAt: null,
    activeExecutions: 0,
  });
  // Re-resolved on a timer as well as on change, because `error` and `done`
  // expire on their own — nothing else would fire to clear them.
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Re-read the state once the shorter of the two holds has elapsed. */
  const scheduleExpiry = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        timer.current = null;
        setTick((n) => n + 1);
      },
      Math.min(DONE_HOLD_MS, ERROR_HOLD_MS),
    );
  }, []);

  useEffect(() => {
    const unsubscribers = [
      sharedEventSource.subscribe('phase_transition', (event) => {
        const { taskId, newPhase } = (event as PhaseEvent) ?? {};
        if (typeof taskId !== 'number' || typeof newPhase !== 'string') return;

        setSignals((prev) => ({
          ...prev,
          phases: applyPhase(prev.phases, taskId, newPhase),
          errorAt: newPhase === 'blocked' ? Date.now() : prev.errorAt,
          doneAt: newPhase === 'completed' ? Date.now() : prev.doneAt,
        }));
        if (newPhase === 'blocked' || newPhase === 'completed') scheduleExpiry();
      }),

      // A failure that never reached a phase transition still counts.
      sharedEventSource.subscribe('execution_failed', () => {
        setSignals((prev) => ({ ...prev, errorAt: Date.now() }));
        scheduleExpiry();
      }),
    ];

    return () => {
      for (const off of unsubscribers) off();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [scheduleExpiry]);

  useEffect(() => {
    let cancelled = false;

    const readHealth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health`);
        if (!res.ok) return;
        const data = (await res.json()) as HealthPayload;
        if (cancelled) return;
        setSignals((prev) => ({ ...prev, activeExecutions: data.activeExecutions ?? 0 }));
      } catch {
        // The avatar is decoration for a backend that may simply be down;
        // a failed read leaves the last known count rather than shouting.
        logger.debug('health read failed; keeping the last execution count');
      }
    };

    void readHealth();
    const id = setInterval(() => void readHealth(), HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return resolveAvatarState(signals, Date.now());
}
