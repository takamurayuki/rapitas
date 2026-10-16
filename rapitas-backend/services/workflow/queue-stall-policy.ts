/**
 * queue-stall-policy
 *
 * Single source of truth for the queue-stall detection thresholds shared by the
 * scheduler-side stall guard and the reconciler-side sweep/starvation passes
 * (task 618). Not responsible for any DB access or side effects — keeping both
 * detection sites on the same constants prevents them from drifting apart.
 */

/**
 * A WorkflowQueueItem left at status='running' longer than this cannot be a
 * legitimately-running phase: it exceeds the WorkflowRunner phase timeout
 * (DEFAULT_PHASE_TIMEOUT_MS = 30m) plus a 10-minute margin for retries and the
 * post-timeout stopTaskAgents wait. Kept well above the 5-minute heartbeat
 * freshness window so a transient heartbeat-write delay can never look stale.
 * / running 残留項目の陳腐化閾値（フェーズタイムアウト30分+余裕10分）。
 */
export const RUNNING_ITEM_STALE_MS = 40 * 60 * 1000;

/**
 * `running=0 かつ queued>0` must persist this long before the starvation pass
 * acts. At the reconciler's 60 s cadence this requires ~3 consecutive
 * observations, so the normal one-tick gap between phases (and the transient
 * post-restart state before the runner re-dequeues) is never misread as a
 * stall (task 585 regression guard). / 飢餓判定の継続時間閾値（誤検出防止）。
 */
export const QUEUE_STARVATION_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * A theme reporting status='running' with ZERO AgentExecution rows for its
 * currentTaskId this long is spinning without doing work (task 653: 21 min of
 * enqueue→cancel produced no execution while every self-report looked healthy).
 * Sits deliberately BETWEEN the runaway-cancel self-heal window
 * (RUNAWAY_CANCEL_WINDOW_MS = 10m in auto-run-advance-active.ts — give it a
 * chance to fix the cancel-loop shape first) and RUNNING_ITEM_STALE_MS (40m),
 * so this is the notify-only backstop for spin patterns the self-heal misses.
 * / 空回り（running報告なのに実行実績ゼロ）の通知閾値。自己修復(10分)より緩く設定。
 */
export const ZERO_PROGRESS_THRESHOLD_MS = 12 * 60 * 1000;
