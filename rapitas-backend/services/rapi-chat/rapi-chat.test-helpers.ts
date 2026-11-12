/**
 * rapi-chat.test-helpers
 *
 * Test-only real SQLite database for the conversation-space tests, built from
 * the production init SQL and wrapped in the production workspace extension,
 * so cascades, unique keys and workspace stamping are the real ones (design
 * §11.1: not mocks). Not responsible for assertions.
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';
import { createWorkspaceExtension, type BaseClientLike } from '../tenancy/workspace-extension';
import type { RapiChatDb } from './rapi-chat-types';

/** A fresh database and its cleanup. */
export interface RapiChatTestDb {
  /** Extended client, as the routes get it from config/database. */
  db: RapiChatDb;
  /** Unextended client for setup and inspection across workspaces. */
  base: PrismaClient;
  dispose: () => Promise<void>;
}

/**
 * Create an empty database with every production table.
 *
 * @returns Clients and a cleanup / クライアントと後始末
 */
export function createRapiChatTestDb(): RapiChatTestDb {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-rapi-chat-'));
  const dbPath = join(dir, 'test.db');
  const init = new Database(dbPath);
  init.exec(SQLITE_INIT_SQL);
  init.close();
  const base = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owned = new Set(['RapiChatSpace', 'RapiChatMessage', 'Task']);
  const db = base.$extends(
    createWorkspaceExtension(owned, base as unknown as BaseClientLike),
  ) as unknown as RapiChatDb;
  return {
    db,
    base,
    dispose: async () => {
      await base.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A plain text item for PUT.
 *
 * @param clientId - Item key / 項目の鍵
 * @param extra - Field overrides / 上書きする項目
 * @returns PUT item / PUT の項目
 */
export function textItem(clientId: string, extra: Record<string, unknown> = {}) {
  return {
    clientId,
    role: 'user',
    kind: 'text',
    text: `発言 ${clientId}`,
    inHistory: true,
    clientCreatedAt: '2026-11-12T10:00:00.000Z',
    ...extra,
  };
}

/**
 * Insert `n` messages directly (for limit tests), returning nothing.
 *
 * @param base - Unextended client / 未拡張クライアント
 * @param spaceId - Space id / スペースID
 * @param n - How many / 件数
 */
export async function seedMessages(base: PrismaClient, spaceId: number, n: number): Promise<void> {
  const rows = Array.from({ length: n }, (_, i) => ({
    spaceId,
    clientId: `seed-${i}`,
    role: 'user',
    kind: 'text',
    text: `seed ${i}`,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await base.rapiChatMessage.createMany({ data: rows.slice(i, i + 500) });
  }
}
