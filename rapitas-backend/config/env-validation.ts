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
