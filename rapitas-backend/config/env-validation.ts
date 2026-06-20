/**
 * Environment Variable Validation
 * Validates required environment variables at startup
 */
import { createLogger } from './logger';

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
      log.warn(warning);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    log.error(message);
    throw new Error(message);
  }

  log.info('Environment variables validated successfully');
}
