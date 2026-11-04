/**
 * browser-e2e/scenario-task-edit
 *
 * Critical flow 1: create a task through the UI, edit its title and status
 * through the UI, reload, and confirm the change both on screen and in the
 * backend. Nothing is stubbed in the clean run — every request reaches the
 * isolated backend. The API read-back is what makes a UI that only updates
 * local state fail.
 */
'use strict';

const { apiPath, openTask } = require('./fixtures.cjs');

/**
 * A status button is selected when it says so: TaskStatusChange exposes
 * aria-pressed. (This used to infer it from a missing hover class, which any
 * styling change would have broken silently.)
 */
async function isStatusSelected(page, label) {
  const pressed = await page
    .locator(`#td-info button[title="${label}"]`)
    .first()
    .getAttribute('aria-pressed');
  return pressed === 'true';
}

/**
 * The update-noop sabotage: PATCH /tasks/:id "succeeds" without writing, and
 * GET /tasks/:id is overlaid with what was patched — the screen looks saved
 * even after a reload (the page's routes survive it), as a UI keeping its own
 * state would. Only the backend read-back can catch this.
 */
async function installUpdateNoop(page, apiBase, api) {
  const overlay = {};
  await page.route(apiPath(apiBase, /^\/tasks\/\d+$/), async (route) => {
    const method = route.request().method();
    if (method !== 'PATCH' && method !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    if (method === 'PATCH') Object.assign(overlay, JSON.parse(route.request().postData() || '{}'));
    const body = { ...(await api.get(`/tasks/${id}`)), ...overlay };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

module.exports = {
  name: 'create-then-update-task',
  /**
   * @param {{page: import('playwright-core').Page, api: ReturnType<import('./fixtures.cjs')['createApi']>, apiBase: string, frontendBase: string, s: Record<string, string>, check: Function, sabotage: string|null}} ctx
   */
  async run({ page, api, apiBase, frontendBase, s, check, sabotage }) {
    const stamp = Date.now();
    const created = `E2E created ${stamp}`;
    const renamed = `E2E renamed ${stamp}`;
    if (sabotage === 'update-noop') await installUpdateNoop(page, apiBase, api);

    // --- create through /tasks/new -----------------------------------------
    await page.goto(`${frontendBase}/tasks/new`, { waitUntil: 'load' });
    const titleInput = page.getByPlaceholder(s.taskNamePlaceholder, { exact: true });
    await titleInput.waitFor({ state: 'visible', timeout: 30_000 });
    await titleInput.fill(created);
    const createResp = page.waitForResponse(
      (r) => apiPath(apiBase, /^\/tasks$/)(new URL(r.url())) && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: s.createSubmit }).click();
    const createRes = await createResp;
    check('POST /tasks answered 2xx', createRes.ok(), `HTTP ${createRes.status()}`);
    const taskId = (await createRes.json()).id;
    check('created task has an id', Number.isInteger(taskId), String(taskId));
    const stored = await api.get(`/tasks/${taskId}`);
    check('backend stored the typed title', stored.title === created, stored.title);

    // --- edit title inline --------------------------------------------------
    const titleEl = await openTask(page, frontendBase, taskId, created);
    await titleEl.dblclick();
    const editor = page.getByRole('textbox', { name: s.titleAriaLabel });
    await editor.fill(renamed);
    const titlePatch = page.waitForResponse(
      (r) =>
        apiPath(apiBase, /^\/tasks\/\d+$/)(new URL(r.url())) && r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );
    await editor.press('Enter');
    check('title PATCH answered 2xx', (await titlePatch).ok());
    const renamedShown = await page
      .locator('#td-info')
      .getByText(renamed, { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check('renamed title is on screen after the save', renamedShown);

    // --- edit status --------------------------------------------------------
    const statusPatch = page.waitForResponse(
      (r) =>
        apiPath(apiBase, /^\/tasks\/\d+$/)(new URL(r.url())) && r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );
    await page.locator(`#td-info button[title="${s.statusInProgress}"]`).first().click();
    check('status PATCH answered 2xx', (await statusPatch).ok());

    // --- reload: the screen must come from the backend now -----------------
    await page.reload({ waitUntil: 'load' });
    const afterReload = page.locator('#td-info').getByText(renamed, { exact: true }).first();
    const shown = await afterReload
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check('renamed title is on screen after reload', shown);
    check(
      'in-progress status is selected after reload',
      await isStatusSelected(page, s.statusInProgress),
    );

    const persisted = await api.get(`/tasks/${taskId}`);
    check('backend has the new title', persisted.title === renamed, persisted.title);
    check('backend has the new status', persisted.status === 'in-progress', persisted.status);
  },
};
