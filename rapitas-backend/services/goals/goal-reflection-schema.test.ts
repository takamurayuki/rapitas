/**
 * goal-reflection-schema.test
 *
 * The generated SQLite init SQL (what the desktop backend applies on boot)
 * carries the GoalReflection table with its one-per-week key and the three
 * UserSettings columns the weekly nudge uses.
 */
import { describe, expect, test } from 'bun:test';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

describe('SQLite init SQL', () => {
  test('creates GoalReflection with the (projectId, weekStart) unique key', () => {
    expect(SQLITE_INIT_SQL).toContain('CREATE TABLE "GoalReflection"');
    expect(SQLITE_INIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "GoalReflection_projectId_weekStart_key" ON "GoalReflection"\("projectId", "weekStart"\)/,
    );
  });

  test('adds the three nudge columns to UserSettings', () => {
    for (const column of [
      '"reflectionPromptDow" INTEGER NOT NULL DEFAULT 0',
      `"reflectionPromptTime" TEXT NOT NULL DEFAULT '20:00'`,
      '"reflectionPromptLastWeek" TEXT',
    ]) {
      expect(SQLITE_INIT_SQL).toContain(column);
    }
  });
});
