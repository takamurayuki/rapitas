/**
 * Configuration exports
 */
export { prisma, ensureDatabaseConnection } from './database';
export { logger, createLogger } from './logger';

import { resolve } from 'path';

/**
 * Get project root (git repository root).
 * Since process.cwd() returns the backend directory (rapitas-backend/),
 * the project root is one level up.
 */
export function getProjectRoot(): string {
  return resolve(process.cwd(), '..');
}
