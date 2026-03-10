/**
 * Database Configuration
 * Prisma client initialization with PostgreSQL
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger';

const log = createLogger('database');

log.info('Connecting to PostgreSQL');

export const prisma = new PrismaClient();

/**
 * DB接続を確認し、接続できるまでリトライする
 * サーバー起動前に呼び出すことで、DB未接続状態でリクエストを受けることを防ぐ
 */
export async function ensureDatabaseConnection(maxRetries = 5, retryDelayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      log.info('PostgreSQL connection established');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) {
        log.error(
          { err: error, maxRetries },
          `Failed to connect after ${maxRetries} attempts: ${message}`,
        );
        throw error;
      }
      log.warn(
        { attempt, maxRetries, retryDelayMs },
        `Connection attempt ${attempt}/${maxRetries} failed: ${message}. Retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
