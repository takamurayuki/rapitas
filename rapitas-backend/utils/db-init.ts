/**
 * Database initialization utility for Tauri/SQLite environments
 * Handles automatic database creation and schema setup
 */
import * as fs from "fs";
import * as path from "path";

export const isTauriBuild = process.env.TAURI_BUILD === "true" || process.env.RAPITAS_SQLITE === "true";

export function getDatabasePath(): string {
  if (isTauriBuild) {
    // For Tauri builds, use app data directory
    const appDataPath = process.env.APPDATA || process.env.HOME || ".";
    const dbDir = path.join(appDataPath, "rapitas");

    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    return path.join(dbDir, "rapitas.db");
  }

  // For development/web, use DATABASE_URL from environment
  return process.env.DATABASE_URL || "";
}

export function getDatabaseUrl(): string {
  if (isTauriBuild) {
    const dbPath = getDatabasePath();
    return `file:${dbPath}`;
  }
  return process.env.DATABASE_URL || "";
}

export function setupEnvironment(): void {
  if (isTauriBuild) {
    // Set DATABASE_URL for Prisma
    process.env.DATABASE_URL = getDatabaseUrl();
    console.log(`[DB] Using SQLite database at: ${getDatabasePath()}`);
  } else {
    console.log(`[DB] Using PostgreSQL database`);
  }
}

// Auto-setup on import
setupEnvironment();
