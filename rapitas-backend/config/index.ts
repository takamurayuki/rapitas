/**
 * Configuration exports
 */
export { prisma, ensureDatabaseConnection } from './database';
export { logger, createLogger } from './logger';

import { resolve } from 'path';

/**
 * プロジェクトルート（gitリポジトリのルート）を取得する。
 * process.cwd() はバックエンドディレクトリ（rapitas-backend/）を返すため、
 * 1階層上のディレクトリがプロジェクトルートになる。
 */
export function getProjectRoot(): string {
  return resolve(process.cwd(), '..');
}
