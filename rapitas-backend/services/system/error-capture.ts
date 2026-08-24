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
 * Every captured error passes through the pii-risk pipeline (secret mask →
 * risk scoring → staged mitigation) before reaching the ring buffer, pino
 * logs, or Sentry. Set RAPITAS_PII_RISK_MITIGATION=off to bypass entirely.
 *
 * Captured sources:
 *   - process uncaughtException / unhandledRejection
 *   - explicit `recordError(...)` calls from anywhere in the app
 *   - frontend errors POSTed to /system/errors
 */

import * as Sentry from '@sentry/bun';
import { createLogger } from '../../config/logger';
import { maskSensitive, maskStringValue } from '../observability/decision-trace/mask';
import {
  assessRisk,
  mitigateContext,
  mitigateText,
  type RiskAssessment,
  type RiskLevel,
} from '../observability/pii-risk';

const log = createLogger('error-capture');

export type ErrorSource = 'uncaughtException' | 'unhandledRejection' | 'explicit' | 'frontend';

export interface CapturedError {
  id: string;
  source: ErrorSource;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
  riskScore?: number;
  riskLevel?: RiskLevel;
}

const RING_SIZE = 100;
const ring: CapturedError[] = [];
let initialized = false;
let sentryActive = false;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Kill switch — 'off' restores the pre-mitigation raw-data behavior wholesale. */
function mitigationDisabled(): boolean {
  return process.env.RAPITAS_PII_RISK_MITIGATION === 'off';
}

/** Serializes a context for risk assessment; empty string when unserializable. */
function contextToText(context: Record<string, unknown> | undefined): string {
  if (!context) return '';
  try {
    return JSON.stringify(context);
  } catch {
    return '';
  }
}

interface MitigatedError {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  assessment: RiskAssessment;
}

/**
 * Runs the full pii-risk pipeline over one error's fields: secret mask
 * first (so secret shapes never feed the PII matcher), then a single risk
 * assessment over the combined text, then level-staged mitigation.
 *
 * @param message - Raw error message / 生のエラーメッセージ
 * @param stack - Raw stack trace, if any / 生のスタックトレース
 * @param context - Raw free-form context, if any / 生のコンテキスト
 * @returns Mitigated fields plus the assessment that drove them / 処理済みフィールドと評価結果
 */
function mitigateError(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown> | undefined,
): MitigatedError {
  const secretMessage = maskStringValue(message).masked;
  const secretStack = stack === undefined ? undefined : maskStringValue(stack).masked;
  const secretContext =
    context === undefined ? undefined : (maskSensitive(context).masked as Record<string, unknown>);

  const assessment = assessRisk(
    [secretMessage, secretStack ?? '', contextToText(secretContext)].join('\n'),
  );

  return {
    message: mitigateText(secretMessage, assessment.level),
    stack: secretStack === undefined ? undefined : mitigateText(secretStack, assessment.level),
    context: mitigateContext(secretContext, assessment.level),
    assessment,
  };
}

/**
 * Sentry beforeSend hook. Strips credential headers always; applies the
 * pii-risk pipeline to exception messages and extra unless the kill switch
 * is set. Exported for direct unit testing.
 *
 * @param event - Sentry event about to be sent / 送信直前のSentryイベント
 * @returns The (possibly mitigated) event / 処理済みイベント
 */
export function sentryBeforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Avoid leaking the master key or session tokens via request headers
  if (event.request?.headers) {
    delete event.request.headers['cookie'];
    delete event.request.headers['authorization'];
  }
  if (mitigationDisabled()) return event;

  const values = event.exception?.values ?? [];
  const secretValues = values.map((v) =>
    typeof v.value === 'string' ? maskStringValue(v.value).masked : undefined,
  );
  const secretMessage =
    typeof event.message === 'string' ? maskStringValue(event.message).masked : undefined;
  const secretExtra =
    event.extra === undefined
      ? undefined
      : (maskSensitive(event.extra).masked as Record<string, unknown>);

  const assessment = assessRisk(
    [
      ...secretValues.filter((s): s is string => typeof s === 'string'),
      secretMessage ?? '',
      contextToText(secretExtra),
    ].join('\n'),
  );

  values.forEach((v, i) => {
    const masked = secretValues[i];
    if (typeof masked === 'string') v.value = mitigateText(masked, assessment.level);
  });
  if (secretMessage !== undefined) {
    event.message = mitigateText(secretMessage, assessment.level);
  }
  if (secretExtra !== undefined) {
    event.extra = mitigateContext(secretExtra, assessment.level);
  }
  return event;
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
        beforeSend: sentryBeforeSend,
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
  const rawMessage = err.message ?? String(err);

  if (mitigationDisabled()) {
    const entry: CapturedError = {
      id: nextId(),
      source,
      message: rawMessage,
      stack: err.stack,
      context,
      timestamp: new Date().toISOString(),
    };
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();
    log.error({ err, source, context }, 'Captured error');
  } else {
    const mitigated = mitigateError(rawMessage, err.stack, context);
    const entry: CapturedError = {
      id: nextId(),
      source,
      message: mitigated.message,
      stack: mitigated.stack,
      context: mitigated.context,
      timestamp: new Date().toISOString(),
      riskScore: mitigated.assessment.score,
      riskLevel: mitigated.assessment.level,
    };
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();

    // NOTE: The raw `err` is intentionally NOT logged here — pino would
    // serialize its unmasked message/stack and defeat the mitigation.
    log.error(
      {
        source,
        message: entry.message,
        stack: entry.stack,
        context: entry.context,
        riskScore: entry.riskScore,
        riskLevel: entry.riskLevel,
      },
      'Captured error',
    );
    if (mitigated.assessment.level === 'high' || mitigated.assessment.level === 'critical') {
      log.warn(
        {
          riskScore: mitigated.assessment.score,
          riskLevel: mitigated.assessment.level,
          piiHitCount: mitigated.assessment.piiHitCount,
          source,
        },
        'High-risk error content auto-mitigated',
      );
    }
  }

  if (sentryActive) {
    try {
      // Raw err/context on purpose: sentryBeforeSend mitigates the generated
      // event, and Sentry's grouping depends on the original stack.
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
