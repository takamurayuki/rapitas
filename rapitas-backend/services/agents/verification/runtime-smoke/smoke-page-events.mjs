/**
 * smoke-page-events
 *
 * Collects the page signals one runtime-smoke check produces, and decides which
 * failed requests actually belong to the page rather than to the check's own
 * teardown.
 * Not responsible for launching a browser or judging the overall verdict — the
 * worker owns the first and runtime-check.ts the second.
 */

/** Cap on recorded failures, so one broken page cannot flood a finding. */
export const MAX_FAILED_REQUESTS = 20;

/** Chromium's error text for a request cancelled rather than rejected. */
const ABORTED = 'net::ERR_ABORTED';

/** A fresh collector for one page. */
export function createPageEvents() {
  return {
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    failedRequests: [],
    pendingRequests: new Map(),
    /**
     * Set the moment the check starts closing the page.
     *
     * NOTE: This is the whole point of the module. Closing a page cancels
     * whatever it had in flight, and Chromium reports each as a
     * `requestfailed` with net::ERR_ABORTED — a cancellation caused by the
     * check itself, not a defect in the application. Measured 2026-10-11: task
     * 1195's spec-intake change was blocked by `runtime=NG(5)` whose only
     * finding was `GET /__rapitas_api/schedules/reminders/pending:
     * net::ERR_ABORTED` while `/` had returned HTTP 200, and the SAME code
     * passed on the next run. Task 1171 hit it too. Roughly one run in five.
     */
    tearingDown: false,
  };
}

/**
 * Record a failed request, unless it is an artefact of the teardown.
 *
 * Only requests the page actually started are considered (the caller tracks
 * them), and only up to the cap.
 *
 * @param events - Collector for this page / 収集先
 * @param request - `{ label, errorText, wasPending }` / 失敗したリクエスト
 * @returns true when it was recorded / 記録した場合 true
 */
export function recordRequestFailure(events, request) {
  const { label, errorText, wasPending } = request;
  if (!wasPending) return false;
  // An abort DURING the run is still the page's own behaviour and is reported;
  // only the ones the close caused are dropped.
  if (events.tearingDown && errorText === ABORTED) return false;
  if (events.failedRequests.length >= MAX_FAILED_REQUESTS) return false;
  events.failedRequests.push(`${label}: ${errorText || 'failed'}`);
  return true;
}

/**
 * Copy the collected signals out of the live collector.
 *
 * NOTE: Copies, not references. The worker read `finding.failedRequests =
 * pageEvents.failedRequests` BEFORE closing the page, so every abort the close
 * then produced was still pushed into the array the finding had already
 * returned — the leak that made the gate flaky even when the handler meant to
 * ignore it.
 *
 * @param events - Collector to snapshot / 収集元
 * @returns Plain arrays safe to return / 返却して安全な配列
 */
export function snapshotPageEvents(events) {
  return {
    pageErrors: [...events.pageErrors],
    consoleErrors: [...events.consoleErrors],
    serverErrors: [...events.serverErrors],
    failedRequests: [...events.failedRequests],
    pendingRequests: [...events.pendingRequests.values()].slice(0, MAX_FAILED_REQUESTS),
  };
}
