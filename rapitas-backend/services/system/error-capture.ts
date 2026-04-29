/**
 * Error Capture
 *
 * Two layers:
 * 1. Always-on local ring buffer of the last N captured errors. Surfaces in
 *    the UI so the user can see what is breaking without any external
 *    service.
 * 2. Optional forwarding to Sentry — enabled only when SENTRY_DSN is set.
 *    No-op otherwise; safe to keep imported in all environments.
 *
 * Captured sources:
 *   - process uncaughtException / unhandledRejection
 *   - explicit `recordError(...)` calls from anywhere in the app
 *   - frontend errors POSTed to /system/errors
 */

import * as Sentry from '@sentry/bun';
import { createLogger } from '../../config/logger';

const log = createLogger('error-capture');

export type ErrorSource = 'uncaughtException' | 'unhandledRejection' | 'explicit' | 'frontend';

export interface CapturedError {
  id: string;
  source: ErrorSource;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const RING_SIZE = 100;
const ring: CapturedError[] = [];
let initialized = false;
let sentryActive = false;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Initialize global handlers + optional Sentry. Safe to call multiple times. */
export function initErrorCapture(): void {
  if (initialized) return;
  initialized = true;

  if (process.env.SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: 0,
        // Avoid leaking the master key or session tokens via stack frames
        beforeSend(event) {
          if (event.request?.headers) {
            delete event.request.headers['cookie'];
            delete event.request.headers['authorization'];
          }
          return event;
        },
      });
      sentryActive = true;
      log.info('Sentry error reporting enabled');
    } catch (err) {
      log.warn({ err }, 'Sentry init failed — continuing with local capture only');
    }
  } else {
    log.debug('SENTRY_DSN not set — local-only error capture');
  }

  process.on('uncaughtException', (err) => {
    captureSync('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureSync('unhandledRejection', err);
  });
}

function captureSync(source: ErrorSource, err: Error, context?: Record<string, unknown>) {
  const entry: CapturedError = {
    id: nextId(),
    source,
    message: err.message ?? String(err),
    stack: err.stack,
    context,
    timestamp: new Date().toISOString(),
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  log.error({ err, source, context }, 'Captured error');

  if (sentryActive) {
    try {
      Sentry.captureException(err, { tags: { source }, extra: context });
    } catch {
      /* never let reporting infra crash the app */
    }
  }
}

/**
 * Record an error explicitly. Use from catch blocks where logging alone is
 * not enough and the user should see it in the recent-errors panel.
 */
export function recordError(err: unknown, context?: Record<string, unknown>): void {
  const e = err instanceof Error ? err : new Error(String(err));
  captureSync('explicit', e, context);
}

/**
 * Record a frontend-reported error. Adds a `frontend` tag so the UI can
 * differentiate browser-origin failures from backend ones.
 */
export function recordFrontendError(input: {
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
}): void {
  const e = new Error(input.message || 'Unknown frontend error');
  if (input.stack) e.stack = input.stack;
  captureSync('frontend', e, { url: input.url, userAgent: input.userAgent });
}

/** Snapshot of the most recent captured errors, newest first. */
export function getRecentErrors(limit = 50): CapturedError[] {
  return ring.slice(-Math.max(1, Math.min(RING_SIZE, limit))).reverse();
}

/** Clear the ring (testing / "I know about these" UI affordance). */
export function clearRecentErrors(): void {
  ring.length = 0;
}

/** Diagnostic — is Sentry actually shipping events? */
export function isSentryActive(): boolean {
  return sentryActive;
}
