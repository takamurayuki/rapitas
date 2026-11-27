CREATE TABLE IF NOT EXISTS "GoalReflection" (
  "id" SERIAL NOT NULL,
  "workspaceId" INTEGER,
  "projectId" INTEGER NOT NULL,
  "weekStart" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoalReflection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalReflection_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoalReflection_projectId_weekStart_key"
  ON "GoalReflection"("projectId", "weekStart");
CREATE INDEX IF NOT EXISTS "GoalReflection_weekStart_idx"
  ON "GoalReflection"("weekStart");

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "reflectionPromptDow" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "reflectionPromptTime" TEXT NOT NULL DEFAULT '20:00';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "reflectionPromptLastWeek" TEXT;

CREATE INDEX IF NOT EXISTS "GoalReflection_workspaceId_idx"
  ON "GoalReflection"("workspaceId");
