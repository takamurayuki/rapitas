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
  inspectPreviewElement,
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

  /** Relay a click/type/key/scroll interaction to the running preview page. */
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
      return { success: true };
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

  /** Check whether a page-space point is a native <select> before the frontend decides how to handle a click on it. */
  .post(
    '/tasks/:id/preview/inspect',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid task id' };
      }
      const result = await inspectPreviewElement(taskId, body.x, body.y);
      if (!result.ok) {
        set.status =
          result.reason === 'not_active'
            ? HTTP_STATUS.NOT_FOUND
            : HTTP_STATUS.INTERNAL_SERVER_ERROR;
        return { success: false, error: result.message ?? result.reason };
      }
      return {
        success: true,
        isSelect: result.isSelect,
        value: result.value,
        options: result.options,
      };
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
