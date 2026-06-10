'use client';
/**
 * GlobalErrorReporter
 *
 * Forwards uncaught browser errors and unhandled promise rejections to
 * POST /system/errors so they show up in the in-app Recent Errors panel
 * (and Sentry if configured server-side).
 */
import { useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';

let recentMessages: { msg: string; ts: number }[] = [];
const DEDUPE_WINDOW_MS = 10_000;

/**
 * Known browser-generated noise that is harmless and produces no actionable signal.
 * Entries use prefix matching (`startsWith`) to tolerate minor message variations
 * across browser versions.
 */
const BENIGN_ERRORS: string[] = [
  // NOTE: Fired by browsers when a ResizeObserver callback takes longer than one animation frame.
  // Harmless — the next frame will deliver the pending notifications automatically.
  'ResizeObserver loop completed with undelivered notifications',
  // NOTE: Older Chrome variant of the same ResizeObserver timing message.
  'ResizeObserver loop limit exceeded',
];

function shouldReport(message: string): boolean {
  if (BENIGN_ERRORS.some((prefix) => message.startsWith(prefix))) return false;
  const now = Date.now();
  recentMessages = recentMessages.filter((r) => now - r.ts < DEDUPE_WINDOW_MS);
  if (recentMessages.some((r) => r.msg === message)) return false;
  recentMessages.push({ msg: message, ts: now });
  return true;
}

function send(payload: { message: string; stack?: string; url?: string; userAgent?: string }) {
  if (!shouldReport(payload.message)) return;
  // fire-and-forget; never block the page on reporting
  fetch(`${API_BASE_URL}/system/errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export default function GlobalErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      send({
        message: event.message,
        stack: event.error?.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection');
      send({
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
