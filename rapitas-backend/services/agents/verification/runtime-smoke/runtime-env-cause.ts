/**
 * runtime-smoke/runtime-env-cause
 *
 * Maps launch-log signatures to a machine-readable environment cause. Pure; it
 * is not responsible for deciding what to do with the cause.
 */
import type { RuntimeEnvCause } from './runtime-server-registry-types';

/**
 * Classify launch logs that show the port or lock was already taken.
 *
 * @param logs - Captured launch output / 起動ログ
 * @returns The environment cause, or undefined when the logs show neither / 原因
 */
export function classifyLaunchLogCause(logs: string[]): RuntimeEnvCause | undefined {
  const text = logs.join('\n');
  if (
    /EADDRINUSE|address already in use|Port \d+ is (?:already )?in use|ポート.*使用中/i.test(text)
  )
    return 'port_in_use';
  if (
    /already running|既に起動しています|Unable to acquire lock|already (?:locked|in use by another)/i.test(
      text,
    )
  )
    return 'lock_held';
  return undefined;
}
