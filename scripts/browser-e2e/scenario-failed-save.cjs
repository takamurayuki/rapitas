/**
 * browser-e2e/scenario-failed-save
 *
 * Critical flow 3: a save the backend rejected must not look saved. The
 * title PATCH is intercepted with HTTP 500; the page must show an error, keep
 * the old title on screen, and still show the old title after a reload.
 * Stubbed: only PATCH /tasks/:id, and only until the reload.
 */
'use strict';

const { apiPath, openTask } = require('./fixtures.cjs');

module.exports = {
  name: 'failed-save-is-not-shown-as-saved',
  /**
   * @param {{page: import('playwright-core').Page, api: ReturnType<import('./fixtures.cjs')['createApi']>, apiBase: string, frontendBase: string, s: Record<string, string>, check: Function, sabotage: string|null}} ctx
   */
  async run({ page, api, apiBase, frontendBase, s, check, sabotage }) {
    const stamp = Date.now();
    const original = `E2E original ${stamp}`;
    const attempted = `E2E never saved ${stamp}`;
    const task = await api.post('/tasks', { title: original });

    const patchRoute = apiPath(apiBase, new RegExp(`^/tasks/${task.id}$`));
    let injected = 0;
    if (sabotage !== 'save-passes') {
      await page.route(patchRoute, (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        injected++;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":"injected by browser-e2e"}',
        });
      });
    }

    const titleEl = await openTask(page, frontendBase, task.id, original);
    await titleEl.dblclick();
    const editor = page.getByRole('textbox', { name: s.titleAriaLabel });
    await editor.fill(attempted);
    const patched = page.waitForResponse(
      (r) => patchRoute(new URL(r.url())) && r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );
    await editor.press('Enter');
    await patched;

    const alert = page.getByRole('alert').filter({ hasText: s.saveFailed });
    const alerted = await alert
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check('a visible error says the save failed', alerted);
    const info = page.locator('#td-info');
    check(
      'the rejected title is not displayed as if saved',
      (await info.getByText(attempted, { exact: true }).count()) === 0,
    );
    check(
      'the old title is still displayed',
      await info.getByText(original, { exact: true }).first().isVisible(),
    );

    await page.unroute(patchRoute);
    await page.reload({ waitUntil: 'load' });
    const oldShown = await info
      .getByText(original, { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check('after reload the old title is shown', oldShown);
    const persisted = await api.get(`/tasks/${task.id}`);
    check('backend still has the old title', persisted.title === original, persisted.title);
    check('the failure was really injected', injected >= 1, `injected=${injected}`);
  },
};
