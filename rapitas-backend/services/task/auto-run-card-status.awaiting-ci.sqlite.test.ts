/** 実際のタスク一覧と同じ関連取得で、子自身のテーマに基づく CI 待ち注釈を検証する。 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient as PostgresClient } from '../../generated/prisma-postgres';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';
import { attachAutoRunCardStatus } from './auto-run-card-status';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-t1570-card-ci-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.workflowTransition.deleteMany();
  await db.task.deleteMany();
  await db.theme.deleteMany();
});

describe('子の theme 関連を取得しない一覧の CI 待ち注釈', () => {
  test.each([
    ['親と同じ開発テーマ', 'same', true, '/repo', null, 'verify_awaiting_required_merge', true],
    ['親と異なる開発テーマ', 'other', true, '/other', null, 'verify_awaiting_required_merge', true],
    ['子は非開発テーマ', 'other', false, '/other', null, 'verify_awaiting_required_merge', false],
    ['子の作業先は空文字', 'other', true, '', null, 'verify_awaiting_required_merge', false],
    ['子の作業先は未設定', 'other', true, null, null, 'verify_awaiting_required_merge', false],
    ['子のテーマは未設定', 'none', true, '/repo', null, 'verify_awaiting_required_merge', false],
    ['子は停止中', 'same', true, '/repo', 'manual_stop', 'verify_awaiting_required_merge', false],
    ['子の最新 cause は修復', 'same', true, '/repo', null, 'ci_repair', false],
  ] as const)(
    '%s',
    async (_name, kind, isDevelopment, workingDirectory, haltReason, cause, expected) => {
      const parentTheme = await db.theme.create({
        data: { name: '親のテーマ', isDevelopment: true, workingDirectory: '/repo' },
      });
      const childThemeId =
        kind === 'none'
          ? null
          : kind === 'same'
            ? parentTheme.id
            : (
                await db.theme.create({
                  data: { name: '子のテーマ', isDevelopment, workingDirectory },
                })
              ).id;
      const parent = await db.task.create({
        data: { title: '親', themeId: parentTheme.id, status: 'todo' },
      });
      const child = await db.task.create({
        data: {
          title: 'CI 待ちの子',
          parentId: parent.id,
          themeId: childThemeId,
          status: 'in-progress',
          workflowStatus: 'verify_done',
          haltReason,
        },
      });
      await db.workflowTransition.create({
        data: {
          taskId: child.id,
          actor: 'system',
          fromStatus: 'verify_done',
          toStatus: 'verify_done',
          cause: 'verify_awaiting_required_merge',
          createdAt: new Date('2026-11-27T00:00:00Z'),
        },
      });
      await db.workflowTransition.create({
        data: {
          taskId: child.id,
          actor: 'system',
          fromStatus: 'verify_done',
          toStatus: 'verify_done',
          cause,
          createdAt: new Date('2026-11-28T00:00:00Z'),
        },
      });
      // GET /tasks の全件・差分取得と同じ include。子の theme は取得しない。
      const rows = await db.task.findMany({
        where: { id: parent.id },
        include: {
          subtasks: { orderBy: { createdAt: 'asc' } },
          theme: true,
          project: true,
          milestone: true,
          taskLabels: { include: { label: true } },
        },
      });
      expect(rows[0].subtasks[0]).not.toHaveProperty('theme');
      const [annotated] = await attachAutoRunCardStatus(db as unknown as PostgresClient, rows);
      expect(annotated.subtasks[0]).toMatchObject({
        autoRunAwaitingCi: expected,
        autoRunCurrent: false,
        autoRunQueued: false,
        autoRunWaitingForSlot: false,
      });
      // 同じ応答オブジェクトへの再注釈でも結果が変わらない。
      await attachAutoRunCardStatus(db as unknown as PostgresClient, rows);
      expect(annotated.subtasks[0]).toHaveProperty('autoRunAwaitingCi', expected);
    },
  );
});
