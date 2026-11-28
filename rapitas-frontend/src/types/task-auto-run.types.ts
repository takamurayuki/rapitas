/**
 * task-auto-run.types
 *
 * The auto-run fields of a Task, split out of task.types.ts (file size).
 * `Task` includes them by intersection, so its shape is unchanged.
 */

/** Auto-run opt-out and the server-computed card flags of one task. */
export type TaskAutoRunFlags = {
  /**
   * User-set exclusion from auto-run task selection. Unrelated to
   * workflowDisabled — the task still runs its normal workflow phases when
   * executed manually, it is just never auto-picked. Freely toggleable at
   * any status.
   */
  autoRunExcluded?: boolean | null;
  /**
   * True when this exact task is the theme's current auto-run pick right
   * now (batched server-side — see attachAutoRunCardStatus). An agent may
   * not actually be dispatched yet (e.g. an overlap-guard hold); pair with
   * the live execution-state store to tell "next up, still waiting" apart
   * from "actually running".
   */
  autoRunCurrent?: boolean;
  /**
   * True when the task is eligible for auto-run selection and its theme is
   * running, but it isn't the current pick yet — waiting its turn behind
   * other tasks.
   */
  autoRunQueued?: boolean;
  /**
   * True when this task is the current pick but other tasks' agents fill
   * every global slot — it waits its turn instead of starting.
   */
  autoRunWaitingForSlot?: boolean;
  /**
   * True while the task is parked for CI / its required merge; the three
   * flags above are then false.
   */
  autoRunAwaitingCi?: boolean;
};
