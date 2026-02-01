/**
 * Tauri/SQLite initialization utility
 * Must be imported at the very start of the application
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

export const isTauriBuild = process.env.TAURI_BUILD === "true" || process.env.RAPITAS_SQLITE === "true";

/**
 * Get the database path for SQLite
 */
export function getDatabasePath(): string {
  // For Tauri builds, use app data directory
  const appDataPath = process.env.APPDATA || process.env.HOME || ".";
  const dbDir = path.join(appDataPath, "rapitas");

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return path.join(dbDir, "rapitas.db");
}

/**
 * Get the database URL for Prisma
 * Returns SQLite URL for Tauri builds, PostgreSQL URL for web builds
 */
export function getDatabaseUrl(): string {
  if (isTauriBuild) {
    const dbPath = getDatabasePath();
    return `file:${dbPath}`;
  }
  // Web mode: use PostgreSQL from .env
  return process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/rapitas";
}

/**
 * Initialize the environment for Tauri builds
 */
export function initTauriEnvironment(): void {
  if (!isTauriBuild) {
    console.log("[Tauri Init] Running in web mode (PostgreSQL)");
    return;
  }

  const dbPath = getDatabasePath();
  const dbUrl = `file:${dbPath}`;

  // Set DATABASE_URL for Prisma
  process.env.DATABASE_URL = dbUrl;
  console.log(`[Tauri Init] Using SQLite database at: ${dbPath}`);

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log("[Tauri Init] Database does not exist, will be created on first access");
  }
}

/**
 * Create or update the SQLite database schema
 */
export async function initializeDatabase(prisma: PrismaClient): Promise<void> {
  if (!isTauriBuild) {
    return;
  }

  const dbPath = getDatabasePath();

  try {
    // Check if database file exists
    if (!fs.existsSync(dbPath)) {
      console.log("[Tauri Init] Creating new SQLite database...");
    }

    // Try to run Prisma db push for schema sync
    // This requires Prisma CLI to be available
    try {
      const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
      if (fs.existsSync(schemaPath)) {
        console.log("[Tauri Init] Running database migration...");
        // Note: In compiled binary, we can't run prisma commands
        // Instead, we use Prisma's $executeRaw to create tables if needed
      }
    } catch (e) {
      // Prisma CLI not available in compiled binary, that's expected
    }

    // Verify database connection
    await prisma.$connect();
    console.log("[Tauri Init] Database connected successfully");

    // Create tables if they don't exist (for compiled binary)
    await createTablesIfNeeded(prisma);

  } catch (error) {
    console.error("[Tauri Init] Failed to initialize database:", error);
    throw error;
  }
}

/**
 * Create tables if they don't exist (for compiled binary without Prisma CLI)
 */
async function createTablesIfNeeded(prisma: PrismaClient): Promise<void> {
  try {
    // Check if Theme table exists by trying to query it
    await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='Theme'`);

    // If we get here without error, check if tables exist
    const tables: any[] = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`
    );

    if (tables.length === 0) {
      console.log("[Tauri Init] No tables found, creating schema...");
      await createSQLiteSchema(prisma);
    } else {
      console.log(`[Tauri Init] Found ${tables.length} existing tables`);
    }
  } catch (error) {
    console.error("[Tauri Init] Error checking tables:", error);
  }
}

/**
 * Create SQLite schema manually (when Prisma CLI is not available)
 */
async function createSQLiteSchema(prisma: PrismaClient): Promise<void> {
  const createTableStatements = [
    // Theme
    `CREATE TABLE IF NOT EXISTS "Theme" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "color" TEXT NOT NULL DEFAULT '#8B5CF6',
      "icon" TEXT,
      "isDefault" BOOLEAN NOT NULL DEFAULT false,
      "isDevelopment" BOOLEAN NOT NULL DEFAULT false,
      "repositoryUrl" TEXT,
      "workingDirectory" TEXT,
      "defaultBranch" TEXT DEFAULT 'main',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // Project
    `CREATE TABLE IF NOT EXISTS "Project" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "color" TEXT NOT NULL DEFAULT '#3B82F6',
      "icon" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // Milestone
    `CREATE TABLE IF NOT EXISTS "Milestone" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "dueDate" DATETIME,
      "projectId" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
    )`,

    // Task
    `CREATE TABLE IF NOT EXISTS "Task" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "status" TEXT NOT NULL DEFAULT 'todo',
      "priority" TEXT NOT NULL DEFAULT 'medium',
      "labels" TEXT NOT NULL DEFAULT '[]',
      "estimatedHours" REAL,
      "actualHours" REAL,
      "dueDate" DATETIME,
      "subject" TEXT,
      "startedAt" DATETIME,
      "completedAt" DATETIME,
      "parentId" INTEGER,
      "themeId" INTEGER,
      "projectId" INTEGER,
      "milestoneId" INTEGER,
      "examGoalId" INTEGER,
      "isDeveloperMode" BOOLEAN NOT NULL DEFAULT false,
      "isAiTaskAnalysis" BOOLEAN NOT NULL DEFAULT false,
      "agentGenerated" BOOLEAN NOT NULL DEFAULT false,
      "agentExecutable" BOOLEAN NOT NULL DEFAULT false,
      "executionInstructions" TEXT,
      "githubIssueId" INTEGER,
      "githubPrId" INTEGER,
      "autoExecutable" BOOLEAN NOT NULL DEFAULT false,
      "requireApproval" TEXT NOT NULL DEFAULT 'always',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE CASCADE,
      FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL,
      FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL
    )`,

    // Label
    `CREATE TABLE IF NOT EXISTS "Label" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "color" TEXT NOT NULL DEFAULT '#6366F1',
      "icon" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // TaskLabel
    `CREATE TABLE IF NOT EXISTS "TaskLabel" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER NOT NULL,
      "labelId" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE,
      FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE,
      UNIQUE("taskId", "labelId")
    )`,

    // TimeEntry
    `CREATE TABLE IF NOT EXISTS "TimeEntry" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER NOT NULL,
      "duration" REAL NOT NULL,
      "breakDuration" REAL DEFAULT 0,
      "note" TEXT,
      "startedAt" DATETIME NOT NULL,
      "endedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
    )`,

    // Comment
    `CREATE TABLE IF NOT EXISTS "Comment" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER NOT NULL,
      "content" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
    )`,

    // ActivityLog
    `CREATE TABLE IF NOT EXISTS "ActivityLog" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER,
      "projectId" INTEGER,
      "action" TEXT NOT NULL,
      "changes" TEXT,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
    )`,

    // UserSettings
    `CREATE TABLE IF NOT EXISTS "UserSettings" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "developerModeDefault" BOOLEAN NOT NULL DEFAULT false,
      "aiTaskAnalysisDefault" BOOLEAN NOT NULL DEFAULT false,
      "claudeApiKeyEncrypted" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // Notification
    `CREATE TABLE IF NOT EXISTS "Notification" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "type" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "link" TEXT,
      "isRead" BOOLEAN NOT NULL DEFAULT false,
      "readAt" DATETIME,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // ExamGoal
    `CREATE TABLE IF NOT EXISTS "ExamGoal" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "examDate" DATETIME NOT NULL,
      "targetScore" TEXT,
      "color" TEXT NOT NULL DEFAULT '#10B981',
      "icon" TEXT,
      "isCompleted" BOOLEAN NOT NULL DEFAULT false,
      "actualScore" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // StudyStreak
    `CREATE TABLE IF NOT EXISTS "StudyStreak" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "date" DATETIME NOT NULL UNIQUE,
      "studyMinutes" INTEGER NOT NULL DEFAULT 0,
      "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // StudyPlan
    `CREATE TABLE IF NOT EXISTS "StudyPlan" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "examGoalId" INTEGER,
      "subject" TEXT NOT NULL,
      "prompt" TEXT NOT NULL,
      "generatedPlan" TEXT NOT NULL,
      "totalDays" INTEGER NOT NULL,
      "startDate" DATETIME NOT NULL,
      "endDate" DATETIME NOT NULL,
      "isApplied" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // DeveloperModeConfig
    `CREATE TABLE IF NOT EXISTS "DeveloperModeConfig" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER NOT NULL UNIQUE,
      "isEnabled" BOOLEAN NOT NULL DEFAULT true,
      "autoApprove" BOOLEAN NOT NULL DEFAULT false,
      "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
      "maxSubtasks" INTEGER NOT NULL DEFAULT 10,
      "priority" TEXT NOT NULL DEFAULT 'balanced',
      "requireApproval" TEXT NOT NULL DEFAULT 'always',
      "autoExecuteOn" TEXT NOT NULL DEFAULT '[]',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
    )`,

    // FavoriteDirectory
    `CREATE TABLE IF NOT EXISTS "FavoriteDirectory" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "path" TEXT NOT NULL UNIQUE,
      "name" TEXT,
      "isGitRepo" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
  ];

  for (const sql of createTableStatements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (error: any) {
      // Ignore "table already exists" errors
      if (!error.message?.includes("already exists")) {
        console.error("[Tauri Init] Error creating table:", error.message);
      }
    }
  }

  console.log("[Tauri Init] Schema creation complete");
}

// Initialize environment on import
initTauriEnvironment();
