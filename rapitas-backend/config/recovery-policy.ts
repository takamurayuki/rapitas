/**
 * Recovery Policy
 *
 * Centralises environment-profile resolution for the dead-execution recovery
 * pipeline: heartbeat cadence, lease staleness, sweep interval, and the
 * auto-resume attempt budget/freshness window. `production` matches the
 * pre-existing hardcoded constants exactly, so adopting this module changes
 * no behaviour unless RAPITAS_RECOVERY_* env vars are explicitly set.
 * Not responsible for consuming these values — see execution-heartbeat.ts,
 * execution-lease-sweep.ts, auto-resume.ts.
 *
 * Environment selection: `NODE_ENV === 'production'` resolves to the
 * `production` profile; anything else (development, unset, or a Bun test
 * run) resolves to `development`. There is no dedicated test-detection flag —
 * tests landing on the faster `development` timings is the safe direction.
 */
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createLogger } from './logger';
import { parseIntEnv } from '../services/agents/abstraction/retry-policy';

const logger = createLogger('recovery-policy');

/** Resolved recovery policy consumed by the dead-execution recovery pipeline. */
export interface RecoveryPolicy {
  /** Heartbeat refresh cadence in ms. Must stay below leaseStaleMs. */
  heartbeatIntervalMs: number;
  /** A running/pending execution is dead once its heartbeat is older than this. */
  leaseStaleMs: number;
  /** Interval in ms between dead-lease sweep passes. */
  leaseSweepIntervalMs: number;
  /** Max automatic resumes per execution before a human must decide. */
  maxAutoResumes: number;
  /** Only resume interruptions younger than this many ms. */
  maxAgeMs: number;
  /** Max executions auto-resumed per sweep pass. */
  maxPerPass: number;
}

type ProfileName = 'production' | 'development';

/**
 * Per-environment defaults. `production` is byte-for-byte identical to the
 * hardcoded constants this module replaces (execution-heartbeat.ts:17,22,
 * execution-lease-sweep.ts:19, auto-resume.ts:25,28,30) — do not change these
 * values without re-verifying every caller's expectation. `development`
 * speeds up the timing fields only; attempt-count fields intentionally match
 * `production` so a looser resume budget can never ship there by accident.
 */
const PROFILES: Record<ProfileName, RecoveryPolicy> = {
  production: {
    heartbeatIntervalMs: 15_000,
    leaseStaleMs: 90_000,
    leaseSweepIntervalMs: 60_000,
    maxAutoResumes: 2,
    maxAgeMs: 86_400_000,
    maxPerPass: 3,
  },
  development: {
    heartbeatIntervalMs: 5_000,
    leaseStaleMs: 20_000,
    leaseSweepIntervalMs: 10_000,
    maxAutoResumes: 2,
    maxAgeMs: 3_600_000,
    maxPerPass: 3,
  },
};

interface FieldSpec {
  key: keyof RecoveryPolicy;
  envVar: string;
  minimum: number;
  maximum: number;
}

/** Env var name, and validation range, for each policy field. */
const FIELD_SPECS: FieldSpec[] = [
  {
    key: 'heartbeatIntervalMs',
    envVar: 'RAPITAS_RECOVERY_HEARTBEAT_INTERVAL_MS',
    minimum: 1_000,
    maximum: 300_000,
  },
  {
    key: 'leaseStaleMs',
    envVar: 'RAPITAS_RECOVERY_LEASE_STALE_MS',
    minimum: 5_000,
    maximum: 3_600_000,
  },
  {
    key: 'leaseSweepIntervalMs',
    envVar: 'RAPITAS_RECOVERY_LEASE_SWEEP_INTERVAL_MS',
    minimum: 5_000,
    maximum: 600_000,
  },
  { key: 'maxAutoResumes', envVar: 'RAPITAS_RECOVERY_MAX_AUTO_RESUMES', minimum: 0, maximum: 20 },
  {
    key: 'maxAgeMs',
    envVar: 'RAPITAS_RECOVERY_MAX_AGE_MS',
    minimum: 60_000,
    maximum: 604_800_000,
  },
  { key: 'maxPerPass', envVar: 'RAPITAS_RECOVERY_MAX_PER_PASS', minimum: 1, maximum: 100 },
];

// NOTE: module-level state for log dedup, not memoized policy — each
// getRecoveryPolicy() call still re-reads process.env (matches retry-policy.ts's
// lazy-per-invocation style so tests can override env between calls).
let warnedKeys = new Set<string>();
let snapshotLogged = false;

/** Emits `logger.warn` at most once per unique `key` for the process lifetime. */
function warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  logger.warn(meta, message);
}

/**
 * Resolves one field: env var override (via parseIntEnv, clamped to the
 * field's minimum) validated against a TypeBox integer schema. Any
 * structural violation (e.g. above maximum) falls back to the profile
 * default and warns once.
 *
 * @param profile - Resolved environment profile / 解決済み環境プロファイル
 * @param spec - Field spec (env var name + valid range) / フィールド仕様
 * @returns Resolved, schema-valid value / 検証済みの値
 */
function resolveField(profile: RecoveryPolicy, spec: FieldSpec): number {
  const profileDefault = profile[spec.key];
  const raw = parseIntEnv(spec.envVar, profileDefault, spec.minimum);
  const schema = Type.Integer({ minimum: spec.minimum, maximum: spec.maximum });
  if (Value.Check(schema, raw)) return raw;
  warnOnce(spec.envVar, '[recovery-policy] value out of range, falling back to profile default', {
    envVar: spec.envVar,
    rejected: raw,
    fallback: profileDefault,
  });
  return profileDefault;
}

/**
 * Enforces the invariant `heartbeatIntervalMs < leaseStaleMs` (a heartbeat
 * cadence at or above the staleness threshold would let a live process look
 * dead). On violation, resets both fields to the profile defaults and warns
 * once rather than rejecting only one of the two conflicting values.
 */
function enforceHeartbeatBelowLeaseStale(
  resolved: RecoveryPolicy,
  profile: RecoveryPolicy,
): RecoveryPolicy {
  if (resolved.heartbeatIntervalMs < resolved.leaseStaleMs) return resolved;
  warnOnce(
    'cross-field:heartbeat-lease-stale',
    '[recovery-policy] heartbeatIntervalMs must stay below leaseStaleMs — resetting both to profile defaults',
    { heartbeatIntervalMs: resolved.heartbeatIntervalMs, leaseStaleMs: resolved.leaseStaleMs },
  );
  return {
    ...resolved,
    heartbeatIntervalMs: profile.heartbeatIntervalMs,
    leaseStaleMs: profile.leaseStaleMs,
  };
}

/** Fields where the resolved value differs from the profile default. */
function diffFromProfile(
  resolved: RecoveryPolicy,
  profile: RecoveryPolicy,
): Record<string, { profileDefault: number; resolved: number }> {
  const diff: Record<string, { profileDefault: number; resolved: number }> = {};
  for (const spec of FIELD_SPECS) {
    if (resolved[spec.key] !== profile[spec.key]) {
      diff[spec.key] = { profileDefault: profile[spec.key], resolved: resolved[spec.key] };
    }
  }
  return diff;
}

/**
 * Logs the resolved policy once per process — this is the "設定変更イベントの記録"
 * (configuration-change event record): the log timestamp is the change time,
 * and diffFromProfile() is the recorded diff against the profile default.
 */
function logSnapshotOnce(
  resolved: RecoveryPolicy,
  profile: RecoveryPolicy,
  name: ProfileName,
): void {
  if (snapshotLogged) return;
  snapshotLogged = true;
  logger.info(
    { profile: name, resolved, diffFromProfileDefault: diffFromProfile(resolved, profile) },
    '[recovery-policy] resolved',
  );
}

/**
 * Resolves the recovery policy for the current process: environment profile,
 * overridden by any set `RAPITAS_RECOVERY_*` env vars, validated against each
 * field's TypeBox schema, with the cross-field heartbeat/lease invariant
 * enforced last.
 *
 * @returns Resolved recovery policy / 解決済み回収ポリシー
 */
export function getRecoveryPolicy(): RecoveryPolicy {
  const profileName: ProfileName =
    process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const profile = PROFILES[profileName];

  const partial: Partial<RecoveryPolicy> = {};
  for (const spec of FIELD_SPECS) {
    partial[spec.key] = resolveField(profile, spec);
  }
  const resolved = enforceHeartbeatBelowLeaseStale(partial as RecoveryPolicy, profile);

  logSnapshotOnce(resolved, profile, profileName);

  return resolved;
}

/** For tests only — clears warn/snapshot dedup state between cases. */
export function __resetRecoveryPolicyLogState(): void {
  warnedKeys = new Set<string>();
  snapshotLogged = false;
}
