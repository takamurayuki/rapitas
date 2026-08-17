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
