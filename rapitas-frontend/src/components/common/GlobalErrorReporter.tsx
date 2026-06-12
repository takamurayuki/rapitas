'use client';
/**
 * GlobalErrorReporter
 *
 * Forwards uncaught browser errors and unhandled promise rejections to
 * POST /system/errors so they show up in the in-app Recent Errors panel
 * (and Sentry if configured server-side).
 * Does NOT report known-benign browser errors (see BENIGN_ERROR_PATTERNS and
 * docs/design/global-error-reporter-filter.md for the full criteria).
 */
import { useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { BENIGN_ERROR_PATTERNS, matchesPattern } from '@/config/benign-error-patterns';

export type { BenignErrorPattern } from '@/config/benign-error-patterns';
export { BENIGN_ERROR_PATTERNS };

/**
 * Returns true if the error message matches a known-benign pattern and should
 * be suppressed (i.e., NOT sent to /system/errors).
 *
 * When ctx is omitted, UA/env constraints are skipped — backward-compatible with
 * callers that pass only the message string.
 *
 * @param message - The error message string to evaluate.
 * @param ctx - Optional context for UA and environment-scoped filtering.
 * @returns true when the message should be silenced, false when it should be reported.
 */
export function isBenign(message: string, ctx?: { ua?: string; env?: string }): boolean {
  return BENIGN_ERROR_PATTERNS.some((entry) => matchesPattern(entry, message, ctx));
}

let recentMessages: { msg: string; ts: number }[] = [];
const DEDUPE_WINDOW_MS = 10_000;

function shouldReport(message: string): boolean {
  const now = Date.now();
  recentMessages = recentMessages.filter((r) => now - r.ts < DEDUPE_WINDOW_MS);
  if (recentMessages.some((r) => r.msg === message)) return false;
  recentMessages.push({ msg: message, ts: now });
  return true;
}

function send(payload: { message: string; stack?: string; url?: string; userAgent?: string }) {
  // NOTE: navigator may be absent in SSR or test environments; ua is undefined in that case,
  // which causes isBenign() to skip UA constraints (SSR-safe by design).
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  const env = process.env.NODE_ENV;
  if (isBenign(payload.message, { ua, env })) return;
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
