/**
 * Preview Routes
 *
 * Start/stop/status/screenshot for a task's embedded live-preview panel.
 * Thin HTTP layer only — session lifecycle lives in preview-session-manager.
 */
import { Elysia, t } from 'elysia';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  screenshotPreview,
} from '../../../services/agents/preview/preview-session-manager';
import {
  interactWithPreview,
  clickPreview,
} from '../../../services/agents/preview/preview-interaction';
import {
  getTaskThemeRuntimeConfigJson,
  setTaskThemeRuntimeConfigJson,
} from '../../../services/agents/verification/runtime-smoke/runtime-config';
import { HTTP_STATUS } from '../../../utils/common/http-status';

export const previewRoutes = new Elysia()
  /**
   * Start (or restart) the task's preview: launches its worktree's dev server
   * + a browser tab. Headless (embedded screenshot view) unless the caller
   * explicitly opts into a real, visible window (the preview-settings
   * modal's "normal display" test mode).
   */
  .post(
    '/tasks/:id/preview/start',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid task id' };
      }
      const result = await startPreview(taskId, { headless: body?.headless });
      if (!result.ok) {
        set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
        return { success: false, reason: result.reason, error: result.message };
      }
      return { success: true, url: result.url };
    },
    {
      body: t.Optional(t.Object({ headless: t.Optional(t.Boolean()) })),
    },
  )

  /** Stop the task's preview session, if one is running. */
  .post('/tasks/:id/preview/stop', async (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: 'Invalid task id' };
    }
    await stopPreview(taskId);
    return { success: true };
  })

  /** Whether a preview is currently running for this task. */
  .get('/tasks/:id/preview/status', (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: 'Invalid task id' };
    }
    return getPreviewStatus(taskId);
  })

  /** Current screenshot of the running preview (PNG). 404 if no session is active. */
  .get('/tasks/:id/preview/screenshot', async (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: 'Invalid task id' };
    }
    const result = await screenshotPreview(taskId);
    if (!result.ok) {
      set.status =
        result.reason === 'not_active' ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      return { error: result.reason === 'not_active' ? 'No active preview' : result.message };
    }
    set.headers['Content-Type'] = 'image/png';
    set.headers['Cache-Control'] = 'no-store';
    return result.buffer;
  })

  /**
   * Relay a type/key/scroll/select interaction to the running preview page
   * and return the resulting frame directly — the frontend used to fire a
   * separate GET /screenshot right after this resolved, paying for a whole
   * extra HTTP+worker+CDP round trip on every relayed interaction.
   */
  .post(
    '/tasks/:id/preview/interact',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid task id' };
      }
      const result = await interactWithPreview(taskId, body);
      if (!result.ok) {
        set.status =
          result.reason === 'not_active'
            ? HTTP_STATUS.NOT_FOUND
            : HTTP_STATUS.INTERNAL_SERVER_ERROR;
        return { success: false, error: result.message ?? result.reason };
      }
      const shot = await screenshotPreview(taskId);
      if (!shot.ok) {
        // Rare (e.g. the session died between the interaction and this
        // screenshot) — the interaction itself still succeeded, so report
        // that; the frontend just keeps showing the last frame.
        return { success: true };
      }
      set.headers['Content-Type'] = 'image/png';
      set.headers['Cache-Control'] = 'no-store';
      return shot.buffer;
    },
    {
      body: t.Union([
        t.Object({ action: t.Literal('click'), x: t.Number(), y: t.Number() }),
        t.Object({ action: t.Literal('type'), text: t.String() }),
        t.Object({ action: t.Literal('key'), key: t.String() }),
        t.Object({
          action: t.Literal('scroll'),
          deltaX: t.Optional(t.Number()),
          deltaY: t.Optional(t.Number()),
        }),
        t.Object({ action: t.Literal('select'), x: t.Number(), y: t.Number(), value: t.String() }),
      ]),
    },
  )

  /**
   * Click at a page-space point and return the resulting frame in one round
   * trip, unless the point is a native <select> — its dropdown is
   * OS/browser chrome and never appears in a screenshot, so no click is
   * relayed and its options are returned instead for the frontend to render
   * its own dropdown. Replaces the old separate inspect-then-interact-then-
   * screenshot sequence (3 round trips) with 1 for the common case.
   */
  .post(
    '/tasks/:id/preview/click',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid task id' };
      }
      const result = await clickPreview(taskId, body.x, body.y);
      if (!result.ok) {
        set.status =
          result.reason === 'not_active'
            ? HTTP_STATUS.NOT_FOUND
            : HTTP_STATUS.INTERNAL_SERVER_ERROR;
        return { success: false, error: result.message ?? result.reason };
      }
      if (result.isSelect) {
        return {
          success: true,
          isSelect: true,
          value: result.value,
          rect: result.rect,
          options: result.options,
        };
      }
      set.headers['Content-Type'] = 'image/png';
      set.headers['Cache-Control'] = 'no-store';
      return result.buffer;
    },
    {
      body: t.Object({ x: t.Number(), y: t.Number() }),
    },
  )

  /** Current runtime config (if any) set on the task's theme — for pre-filling the inline task-detail editor. */
  .get('/tasks/:id/preview/runtime-config', async (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: 'Invalid task id' };
    }
    const result = await getTaskThemeRuntimeConfigJson(taskId);
    if (result.themeId === null) {
      return { hasTheme: false, runtimeConfigJson: null };
    }
    return { hasTheme: true, runtimeConfigJson: result.runtimeConfigJson };
  })

  /** Save the task's theme runtime config directly from the task detail page — lets a "not configured" preview failure be fixed on the spot. */
  .put(
    '/tasks/:id/preview/runtime-config',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid task id' };
      }
      const result = await setTaskThemeRuntimeConfigJson(taskId, body.runtimeConfigJson);
      if (!result.ok) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { success: false, error: result.error };
      }
      return { success: true };
    },
    {
      body: t.Object({ runtimeConfigJson: t.String() }),
    },
  );
