/**
 * Environment Variable Validation
 * Validates required environment variables at startup
 */
import { createLogger } from './logger';
import { getRecoveryPolicy } from './recovery-policy';

const log = createLogger('env-validation');

interface EnvVar {
  name: string;
  required: boolean;
  defaultValue?: string;
}

const ENV_VARS: EnvVar[] = [
  { name: 'DATABASE_URL', required: true },
  { name: 'PORT', required: false, defaultValue: '3001' },
  { name: 'NODE_ENV', required: false, defaultValue: 'development' },
  { name: 'CORS_ORIGIN', required: false },
  { name: 'FRONTEND_URL', required: false, defaultValue: 'http://localhost:3000' },
  { name: 'ENCRYPTION_KEY', required: false },
  { name: 'UPLOAD_DIR', required: false, defaultValue: 'uploads' },

  // Agent retry policy (all optional — defaults preserve pre-existing behaviour).
  // Global fallback (hook-less path):
  { name: 'RAPITAS_RETRY_MAX', required: false, defaultValue: '3' },
  { name: 'RAPITAS_RETRY_DELAY_MS', required: false, defaultValue: '3000' },
  { name: 'RAPITAS_RETRY_UPPER_BOUND', required: false, defaultValue: '10' },
  // Per-error-type overrides — representative keys listed here for visibility.
  // Full set: RAPITAS_RETRY_<TYPE>_{MAX,DELAY_MS,MAX_DELAY_MS,BACKOFF}
  // where <TYPE> is the AgentErrorType in UPPER_SNAKE_CASE (e.g. RATE_LIMIT, NETWORK, TIMEOUT).
  { name: 'RAPITAS_RETRY_RATE_LIMIT_MAX', required: false },
  { name: 'RAPITAS_RETRY_RATE_LIMIT_DELAY_MS', required: false },
  { name: 'RAPITAS_RETRY_NETWORK_MAX', required: false },
  { name: 'RAPITAS_RETRY_TIMEOUT_MAX', required: false },

  // Git cache configuration (all optional — defaults preserve pre-existing behaviour).
  // Set to '0' to bypass all git caching layers (both local exec and remote URL).
  { name: 'RAPITAS_GIT_EXEC_CACHE', required: false },
  // TTL in milliseconds for the local git exec cache (git rev-parse, etc.).
  { name: 'RAPITAS_GIT_EXEC_CACHE_TTL_MS', required: false, defaultValue: '30000' },
  // TTL in milliseconds for the git remote URL cache (git remote get-url origin).
  { name: 'RAPITAS_GIT_REMOTE_CACHE_TTL_MS', required: false, defaultValue: '30000' },

  // Recovery policy overrides (all optional). The actual resolved default depends
  // on NODE_ENV (production vs development — see config/recovery-policy.ts), so no
  // single defaultValue is listed here; the resolved snapshot is logged separately
  // by getRecoveryPolicy() below.
  { name: 'RAPITAS_RECOVERY_HEARTBEAT_INTERVAL_MS', required: false },
  { name: 'RAPITAS_RECOVERY_LEASE_STALE_MS', required: false },
  { name: 'RAPITAS_RECOVERY_LEASE_SWEEP_INTERVAL_MS', required: false },
  { name: 'RAPITAS_RECOVERY_MAX_AUTO_RESUMES', required: false },
  { name: 'RAPITAS_RECOVERY_MAX_AGE_MS', required: false },
  { name: 'RAPITAS_RECOVERY_MAX_PER_PASS', required: false },
];

export function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];

    if (!value && envVar.required) {
      missing.push(envVar.name);
    } else if (!value && !envVar.required && envVar.defaultValue) {
      warnings.push(`${envVar.name} not set, using default: ${envVar.defaultValue}`);
    }
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      // Falling back to a documented default is normal operation, not a
      // warning — keep startup logs clean so real WARNs stay visible.
      log.debug(warning);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    log.error(message);
    throw new Error(message);
  }

  log.info('Environment variables validated successfully');

  // Triggers the recovery-policy resolved-snapshot log (once per process) —
  // this is the "設定変更イベントの記録" (config-change event record) for the
  // recovery-policy layer: timestamp = this log line, diff = against profile default.
  getRecoveryPolicy();
}
