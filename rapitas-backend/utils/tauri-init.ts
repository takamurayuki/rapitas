/**
 * Tauri/SQLite initialization utility
 * Must be imported at the very start of the application
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

export const isTauriBuild =
  process.env.TAURI_BUILD === "true" || process.env.RAPITAS_SQLITE === "true";

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
  return (
    process.env.DATABASE_URL ||
    "postgresql://user:password@localhost:5432/rapitas"
  );
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
    console.log(
      "[Tauri Init] Database does not exist, will be created on first access",
    );
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
    await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='Theme'`,
    );

    // If we get here without error, check if tables exist
    const tables: any[] = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`,
    );

    if (tables.length === 0) {
      console.log("[Tauri Init] No tables found, creating schema...");
      await createSQLiteSchema(prisma);
    } else {
      console.log(`[Tauri Init] Found ${tables.length} existing tables`);
      // Always run schema updates to add missing tables/columns
      await createSQLiteSchema(prisma);
      await migrateSchema(prisma);
    }
  } catch (error) {
    console.error("[Tauri Init] Error checking tables:", error);
  }
}

/**
 * Migrate schema - add new columns to existing tables
 */
async function migrateSchema(prisma: PrismaClient): Promise<void> {
  const migrations = [
    // Add file upload fields to Resource table
    { table: "Resource", column: "filePath", sql: `ALTER TABLE "Resource" ADD COLUMN "filePath" TEXT` },
    { table: "Resource", column: "fileName", sql: `ALTER TABLE "Resource" ADD COLUMN "fileName" TEXT` },
    { table: "Resource", column: "fileSize", sql: `ALTER TABLE "Resource" ADD COLUMN "fileSize" INTEGER` },
    { table: "Resource", column: "mimeType", sql: `ALTER TABLE "Resource" ADD COLUMN "mimeType" TEXT` },
  ];

  for (const migration of migrations) {
    try {
      // Check if column exists
      const columns: any[] = await prisma.$queryRawUnsafe(
        `PRAGMA table_info("${migration.table}")`
      );
      const columnExists = columns.some((col: any) => col.name === migration.column);

      if (!columnExists) {
        await prisma.$executeRawUnsafe(migration.sql);
        console.log(`[Tauri Init] Added column ${migration.column} to ${migration.table}`);
      }
    } catch (error: any) {
      // Ignore errors (column might already exist or table doesn't exist)
      if (!error.message?.includes("duplicate column")) {
        console.debug(`[Tauri Init] Migration skipped: ${migration.column} on ${migration.table}`);
      }
    }
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

    // Resource
    `CREATE TABLE IF NOT EXISTS "Resource" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER,
      "title" TEXT NOT NULL,
      "url" TEXT,
      "type" TEXT NOT NULL,
      "description" TEXT,
      "filePath" TEXT,
      "fileName" TEXT,
      "fileSize" INTEGER,
      "mimeType" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
    )`,

    // Achievement
    `CREATE TABLE IF NOT EXISTS "Achievement" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "key" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "icon" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#FFD700',
      "category" TEXT NOT NULL,
      "condition" TEXT NOT NULL,
      "rarity" TEXT NOT NULL DEFAULT 'common',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // UserAchievement
    `CREATE TABLE IF NOT EXISTS "UserAchievement" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "achievementId" INTEGER NOT NULL UNIQUE,
      "unlockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE
    )`,

    // Habit
    `CREATE TABLE IF NOT EXISTS "Habit" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "icon" TEXT,
      "color" TEXT NOT NULL DEFAULT '#10B981',
      "frequency" TEXT NOT NULL DEFAULT 'daily',
      "targetCount" INTEGER NOT NULL DEFAULT 1,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // HabitLog
    `CREATE TABLE IF NOT EXISTS "HabitLog" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "habitId" INTEGER NOT NULL,
      "date" DATETIME NOT NULL,
      "count" INTEGER NOT NULL DEFAULT 1,
      "note" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE,
      UNIQUE("habitId", "date")
    )`,

    // FlashcardDeck
    `CREATE TABLE IF NOT EXISTS "FlashcardDeck" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "color" TEXT NOT NULL DEFAULT '#3B82F6',
      "taskId" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // Flashcard
    `CREATE TABLE IF NOT EXISTS "Flashcard" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "deckId" INTEGER NOT NULL,
      "front" TEXT NOT NULL,
      "back" TEXT NOT NULL,
      "nextReview" DATETIME,
      "interval" INTEGER NOT NULL DEFAULT 1,
      "easeFactor" REAL NOT NULL DEFAULT 2.5,
      "reviewCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("deckId") REFERENCES "FlashcardDeck"("id") ON DELETE CASCADE
    )`,

    // TaskTemplate
    `CREATE TABLE IF NOT EXISTS "TaskTemplate" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "category" TEXT NOT NULL,
      "templateData" TEXT NOT NULL,
      "isPublic" BOOLEAN NOT NULL DEFAULT false,
      "useCount" INTEGER NOT NULL DEFAULT 0,
      "themeId" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL
    )`,

    // AgentSession
    `CREATE TABLE IF NOT EXISTS "AgentSession" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "configId" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "startedAt" DATETIME,
      "completedAt" DATETIME,
      "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "totalTokensUsed" INTEGER NOT NULL DEFAULT 0,
      "errorMessage" TEXT,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("configId") REFERENCES "DeveloperModeConfig"("id") ON DELETE CASCADE
    )`,

    // AgentAction
    `CREATE TABLE IF NOT EXISTS "AgentAction" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "sessionId" INTEGER NOT NULL,
      "actionType" TEXT NOT NULL,
      "targetTaskId" INTEGER,
      "input" TEXT,
      "output" TEXT,
      "tokensUsed" INTEGER NOT NULL DEFAULT 0,
      "durationMs" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'success',
      "errorMessage" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE
    )`,

    // ApprovalRequest
    `CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "configId" INTEGER NOT NULL,
      "requestType" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "proposedChanges" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "expiresAt" DATETIME,
      "approvedAt" DATETIME,
      "rejectedAt" DATETIME,
      "rejectionReason" TEXT,
      "notificationSent" BOOLEAN NOT NULL DEFAULT false,
      "executionType" TEXT,
      "estimatedChanges" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("configId") REFERENCES "DeveloperModeConfig"("id") ON DELETE CASCADE
    )`,

    // AIAgentConfig
    `CREATE TABLE IF NOT EXISTS "AIAgentConfig" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "agentType" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "apiKeyEncrypted" TEXT,
      "endpoint" TEXT,
      "modelId" TEXT,
      "isDefault" BOOLEAN NOT NULL DEFAULT false,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "capabilities" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // AgentExecution
    `CREATE TABLE IF NOT EXISTS "AgentExecution" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "sessionId" INTEGER NOT NULL,
      "agentConfigId" INTEGER,
      "command" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "output" TEXT,
      "artifacts" TEXT,
      "startedAt" DATETIME,
      "completedAt" DATETIME,
      "tokensUsed" INTEGER NOT NULL DEFAULT 0,
      "executionTimeMs" INTEGER,
      "errorMessage" TEXT,
      "question" TEXT,
      "questionType" TEXT,
      "questionDetails" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE,
      FOREIGN KEY ("agentConfigId") REFERENCES "AIAgentConfig"("id") ON DELETE SET NULL
    )`,

    // GitHubIntegration
    `CREATE TABLE IF NOT EXISTS "GitHubIntegration" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "repositoryUrl" TEXT NOT NULL UNIQUE,
      "repositoryName" TEXT NOT NULL,
      "ownerName" TEXT NOT NULL,
      "accessTokenEnc" TEXT,
      "webhookSecret" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "syncIssues" BOOLEAN NOT NULL DEFAULT true,
      "syncPullRequests" BOOLEAN NOT NULL DEFAULT true,
      "autoLinkTasks" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,

    // GitHubPullRequest
    `CREATE TABLE IF NOT EXISTS "GitHubPullRequest" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "integrationId" INTEGER NOT NULL,
      "prNumber" INTEGER NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT,
      "state" TEXT NOT NULL,
      "headBranch" TEXT NOT NULL,
      "baseBranch" TEXT NOT NULL,
      "authorLogin" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "linkedTaskId" INTEGER,
      "lastSyncedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("integrationId") REFERENCES "GitHubIntegration"("id") ON DELETE CASCADE,
      UNIQUE("integrationId", "prNumber")
    )`,

    // GitHubPRReview
    `CREATE TABLE IF NOT EXISTS "GitHubPRReview" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "pullRequestId" INTEGER NOT NULL,
      "reviewId" INTEGER NOT NULL,
      "state" TEXT NOT NULL,
      "body" TEXT,
      "authorLogin" TEXT NOT NULL,
      "submittedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("pullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE CASCADE
    )`,

    // GitHubPRComment
    `CREATE TABLE IF NOT EXISTS "GitHubPRComment" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "pullRequestId" INTEGER NOT NULL,
      "commentId" INTEGER NOT NULL,
      "body" TEXT NOT NULL,
      "path" TEXT,
      "line" INTEGER,
      "authorLogin" TEXT NOT NULL,
      "isFromRapitas" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("pullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE CASCADE
    )`,

    // GitHubIssue
    `CREATE TABLE IF NOT EXISTS "GitHubIssue" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "integrationId" INTEGER NOT NULL,
      "issueNumber" INTEGER NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT,
      "state" TEXT NOT NULL,
      "labels" TEXT NOT NULL DEFAULT '[]',
      "authorLogin" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "linkedTaskId" INTEGER,
      "lastSyncedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("integrationId") REFERENCES "GitHubIntegration"("id") ON DELETE CASCADE,
      UNIQUE("integrationId", "issueNumber")
    )`,

    // GitCommit
    `CREATE TABLE IF NOT EXISTS "GitCommit" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "executionId" INTEGER NOT NULL,
      "commitHash" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "branch" TEXT NOT NULL,
      "filesChanged" INTEGER NOT NULL DEFAULT 0,
      "additions" INTEGER NOT NULL DEFAULT 0,
      "deletions" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE
    )`,

    // TaskPrompt
    `CREATE TABLE IF NOT EXISTS "TaskPrompt" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "taskId" INTEGER NOT NULL,
      "name" TEXT,
      "originalDescription" TEXT,
      "optimizedPrompt" TEXT NOT NULL,
      "structuredSections" TEXT,
      "qualityScore" INTEGER,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
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
