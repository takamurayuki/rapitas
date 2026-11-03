/**
 * browser-e2e/scenario-stop-failure
 *
 * Critical flow 2: when a stop request fails, the page must say so and must
 * keep showing the execution as running — never as stopped/idle (#1330).
 *
 * Stubbed, and only these two (CI has no agent CLI, so no real run exists):
 *   GET  /tasks/:id/execution-status[?outputOffset=n] → a running execution
 *        with no sessionId. Both the restore path (useDeveloperMode) and the
 *        poll loop read this one endpoint; "running" there is what renders
 *        the stop button. No sessionId, so no SSE stream is opened and the
 *        session-level stop fallback is not taken (it is covered by
 *        stop-execution-request.test.ts).
 *   POST /tasks/:id/stop-execution → HTTP 500 {success:false}.
 * Everything else — the task, its theme, the page — is real.
 */
'use strict';

const { apiPath, openTask } = require('./fixtures.cjs');

/** How long the failed state must hold, so a delayed flip to idle is caught too. */
const HOLD_MS = 4000;

/** The fake "running" row; field names mirror the execution-status route. */
function runningStatus(taskId) {
  return {
    taskId,
    executionId: 1,
    executionStatus: 'running',
    status: 'running',
    output: '[browser-e2e] stubbed running execution\n',
    outputLength: 41,
    waitingForInput: false,
  };
}

module.exports = {
  name: 'stop-failure-is-shown',
  /**
   * @param {{page: import('playwright-core').Page, api: ReturnType<import('./fixtures.cjs')['createApi']>, apiBase: string, frontendBase: string, s: Record<string, string>, check: Function, sabotage: string|null, themeId: number}} ctx
   */
  async run({ page, api, apiBase, frontendBase, s, check, sabotage, themeId }) {
    const title = `E2E stop ${Date.now()}`;
    // A theme with a workingDirectory is what renders the execution card at all.
    const task = await api.post('/tasks', { title, themeId });

    await page.route(apiPath(apiBase, new RegExp(`^/tasks/${task.id}/execution-status$`)), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runningStatus(task.id)) }),
    );
    let stopCalls = 0;
    await page.route(apiPath(apiBase, new RegExp(`^/tasks/${task.id}/stop-execution$`)), (route) => {
      stopCalls++;
      return sabotage === 'stop-succeeds'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
        : route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"success":false,"error":"injected by browser-e2e"}',
          });
    });

    await openTask(page, frontendBase, task.id, title);
    const stop = page.getByRole('button', { name: s.stopAria });
    const appeared = await stop
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check('stop button renders for a running execution', appeared);

    await stop.click();
    const alert = page.getByRole('alert').filter({ hasText: s.stopFailed });
    const alerted = await alert
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check('the stop request reached the (stubbed) endpoint', stopCalls >= 1, `calls=${stopCalls}`);
    check('a visible error says the stop failed', alerted);

    await page.waitForTimeout(HOLD_MS);
    check('stop button is still shown (execution still running)', await stop.isVisible());
    check('stop button is usable again for a retry', await stop.isEnabled());
    const runButtons = await page.getByRole('button', { name: s.startExecution }).count();
    check('the idle "start execution" button is not shown', runButtons === 0, `count=${runButtons}`);
    check('the error is still visible', await alert.isVisible());
  },
};
