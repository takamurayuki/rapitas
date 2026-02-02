/**
 * Database Configuration
 * Prisma client initialization with SQLite/PostgreSQL support
 */
import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl, isTauriBuild } from "../utils/tauri-init";

const dbUrl = getDatabaseUrl();

console.log(`[DB] Connecting to: ${isTauriBuild ? "SQLite" : "PostgreSQL"}`);
console.log(`[DB] URL: ${dbUrl.substring(0, 50)}...`);

export const prisma = new PrismaClient({
  datasourceUrl: dbUrl,
});

// Re-export for convenience
export { isTauriBuild };
