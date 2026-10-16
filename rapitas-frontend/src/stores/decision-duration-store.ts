/**
 * decision-duration-store
 *
 * Local-only (localStorage) record of recent decision durations per kind.
 * Never sent to the backend: the data must stay on this device.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DECISION_WINDOW_SIZE,
  appendDuration,
  isValidDuration,
} from '@/app/triage/_lib/decision-duration-stats';

interface DecisionDurationState {
  /** Recent durations in ms per decision kind, oldest first. */
  durations: Record<string, number[]>;
  /** Record a finished decision of `kind` that took `ms`. */
  record: (kind: string, ms: number) => void;
  clear: () => void;
}

// A hand-edited or corrupt value must not crash the page, so keep only well-formed entries.
function sanitize(input: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [kind, list] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const valid = list.filter((v): v is number => typeof v === 'number' && isValidDuration(v));
    if (valid.length > 0) out[kind] = valid.slice(-DECISION_WINDOW_SIZE);
  }
  return out;
}

export const useDecisionDurationStore = create<DecisionDurationState>()(
  persist(
    (set) => ({
      durations: {},
      record: (kind, ms) =>
        set((s) => {
          if (!isValidDuration(ms)) return s;
          return {
            durations: { ...s.durations, [kind]: appendDuration(s.durations[kind] ?? [], ms) },
          };
        }),
      clear: () => set({ durations: {} }),
    }),
    {
      name: 'rapitas-decision-durations',
      version: 1,
      partialize: (s) => ({ durations: s.durations }),
      merge: (persisted, current) => ({
        ...current,
        durations: sanitize((persisted as { durations?: unknown } | undefined)?.durations),
      }),
    },
  ),
);
