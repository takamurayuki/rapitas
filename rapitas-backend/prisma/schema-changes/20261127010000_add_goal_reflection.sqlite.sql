CREATE TABLE IF NOT EXISTS "GoalReflection" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "projectId" INTEGER NOT NULL,
  "weekStart" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GoalReflection_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoalReflection_projectId_weekStart_key"
  ON "GoalReflection"("projectId", "weekStart");
CREATE INDEX IF NOT EXISTS "GoalReflection_weekStart_idx"
  ON "GoalReflection"("weekStart");

ALTER TABLE "UserSettings" ADD COLUMN "reflectionPromptDow" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN "reflectionPromptTime" TEXT NOT NULL DEFAULT '20:00';
ALTER TABLE "UserSettings" ADD COLUMN "reflectionPromptLastWeek" TEXT;
