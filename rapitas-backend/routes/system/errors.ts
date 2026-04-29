/**
 * Error Routes
 *
 * Exposes the in-memory error ring buffer to the UI and accepts frontend
 * error reports.
 */
import { Elysia, t } from 'elysia';
import {
  clearRecentErrors,
  getRecentErrors,
  isSentryActive,
  recordFrontendError,
} from '../../services/system/error-capture';

export const errorsRoutes = new Elysia({ prefix: '/system/errors' })
  .get('/', () => ({
    sentryEnabled: isSentryActive(),
    errors: getRecentErrors(50),
  }))

  .delete('/', () => {
    clearRecentErrors();
    return { success: true };
  })

  .post(
    '/',
    ({ body }) => {
      recordFrontendError({
        message: body.message,
        stack: body.stack,
        url: body.url,
        userAgent: body.userAgent,
      });
      return { success: true };
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 2000 }),
        stack: t.Optional(t.String({ maxLength: 8000 })),
        url: t.Optional(t.String({ maxLength: 1000 })),
        userAgent: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  );
