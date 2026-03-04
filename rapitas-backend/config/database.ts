/**
 * Database Configuration
 * Prisma client initialization with PostgreSQL
 */
import { PrismaClient } from "@prisma/client";

console.log("[DB] Connecting to PostgreSQL");

export const prisma = new PrismaClient();

/**
 * DB接続を確認し、接続できるまでリトライする
 * サーバー起動前に呼び出すことで、DB未接続状態でリクエストを受けることを防ぐ
 */
export async function ensureDatabaseConnection(
  maxRetries = 5,
  retryDelayMs = 1000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      console.log("[DB] PostgreSQL connection established");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) {
        console.error(
          `[DB] Failed to connect after ${maxRetries} attempts: ${message}`,
        );
        throw error;
      }
      console.warn(
        `[DB] Connection attempt ${attempt}/${maxRetries} failed: ${message}. Retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
