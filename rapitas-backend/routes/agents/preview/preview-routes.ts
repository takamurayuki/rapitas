/**
 * Preview Routes
 *
 * Start/stop/status/screenshot for a task's embedded live-preview panel.
 * Thin HTTP layer only — session lifecycle lives in preview-session-manager.
 */
import { Elysia } from 'elysia';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  screenshotPreview,
} from '../../../services/agents/preview/preview-session-manager';
import { HTTP_STATUS } from '../../../utils/common/http-status';

export const previewRoutes = new Elysia()
  /** Start (or restart) the task's preview: launches its worktree's dev server + a headless browser tab. */
  .post('/tasks/:id/preview/start', async (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: 'Invalid task id' };
    }
    const result = await startPreview(taskId);
    if (!result.ok) {
      set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
      return { success: false, reason: result.reason, error: result.message };
    }
    return { success: true, url: result.url };
  })

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
  });
