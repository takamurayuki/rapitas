/**
 * goal-reflection-schema.test
 *
 * GoalReflection and the three UserSettings nudge columns must agree in every
 * place the schema lives: prisma/schema (the source), prisma/schema.desktop,
 * the SQLite and PostgreSQL init SQL, and the hand-written migration SQL. A
 * missing generated file is what turned CI red before, so each place is pinned.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { POSTGRES_INIT_SQL } from '../src/generated/postgres-init-sql';
import { SQLITE_INIT_SQL } from '../src/generated/sqlite-init-sql';

const prismaDir = __dirname;
const NUDGE_COLUMNS = ['reflectionPromptDow', 'reflectionPromptTime', 'reflectionPromptLastWeek'];

function readSchemaDir(dir: string): string {
  const full = join(prismaDir, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => readFileSync(join(full, f), 'utf8'))
    .join('\n');
}

const source = readSchemaDir('schema');
const desktop = readSchemaDir('schema.desktop');
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('prisma/schema (source of truth)', () => {
  test('defines GoalReflection exactly once, with the one-per-week key, cascade and workspace column', () => {
    expect(count(source, 'model GoalReflection {')).toBe(1);
    // CRLFでも次のモデルの列や索引を誤って拾わない。
    const body = source.match(/^model GoalReflection \{([^]*?)^\}/m)?.[1] ?? '';
    expect(body).toContain('@@unique([projectId, weekStart])');
    expect(body).toContain('onDelete: Cascade');
    expect(body).toMatch(/workspaceId\s+Int\?/);
    expect(body).toContain('@@index([workspaceId])');
  });

  test('declares each nudge column on UserSettings once', () => {
    for (const column of NUDGE_COLUMNS) expect(count(source, column)).toBe(1);
  });

  test.each(['schema', 'schema.desktop'])('%s は定義を所有者ファイルに置く', (dir) => {
    const core = readFileSync(join(prismaDir, dir, 'core.prisma'), 'utf8');
    const system = readFileSync(join(prismaDir, dir, 'system.prisma'), 'utf8');
    const reflection = core.match(/^model GoalReflection \{([^]*?)^\}/m)?.[1] ?? '';
    const settings = system.match(/^model UserSettings \{([^]*?)^\}/m)?.[1] ?? '';
    const project = core.match(/^model Project \{([^]*?)^\}/m)?.[1] ?? '';
    expect(reflection).toMatch(/^\s*workspaceId\s+Int\?/m);
    expect(reflection).toContain('@@index([workspaceId])');
    expect(reflection).toContain('@@unique([projectId, weekStart])');
    expect(reflection).toContain('onDelete: Cascade');
    expect(project).toMatch(/reflections\s+GoalReflection\[\]/);
    for (const column of NUDGE_COLUMNS) {
      expect(count(settings, column)).toBe(1);
    }
  });
});

describe('generated and hand-written copies', () => {
  test('schema.desktop carries the model and the columns', () => {
    expect(count(desktop, 'model GoalReflection {')).toBe(1);
    for (const column of NUDGE_COLUMNS) expect(count(desktop, column)).toBe(1);
  });

  test.each([
    ['SQLite init SQL', SQLITE_INIT_SQL],
    ['PostgreSQL init SQL', POSTGRES_INIT_SQL],
  ])('%s creates the table, its unique key and the three columns', (_name, sql) => {
    expect(sql).toContain('CREATE TABLE "GoalReflection"');
    const table = sql.match(/CREATE TABLE "GoalReflection" \(([^]*?)\n\);/)?.[1] ?? '';
    expect(table).toMatch(/"workspaceId" INTEGER/);
    expect(sql).toContain(
      'CREATE INDEX "GoalReflection_workspaceId_idx" ON "GoalReflection"("workspaceId")',
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "GoalReflection_projectId_weekStart_key" ON "GoalReflection"\("projectId", "weekStart"\)/,
    );
    const settings = sql.match(/CREATE TABLE "UserSettings" \(([^]*?)\n\);/)?.[1] ?? '';
    for (const column of NUDGE_COLUMNS) expect(settings).toContain(`"${column}"`);
  });

  test.each(['sqlite', 'postgresql'])('the %s migration SQL names the same columns', (dialect) => {
    const sql = readFileSync(
      join(prismaDir, 'schema-changes', `20261127010000_add_goal_reflection.${dialect}.sql`),
      'utf8',
    );
    expect(sql).toContain('"GoalReflection"');
    expect(sql).toContain('"workspaceId"');
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "GoalReflection_workspaceId_idx"\s+ON "GoalReflection"\("workspaceId"\)/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "GoalReflection_projectId_weekStart_key"\s+ON "GoalReflection"\("projectId", "weekStart"\)/,
    );
    for (const column of NUDGE_COLUMNS) expect(sql).toContain(`"${column}"`);
  });
});
