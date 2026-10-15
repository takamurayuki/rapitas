/**
 * project-prisma-client テスト
 *
 * どのコマンドで生成するかの決定と、生成の実行・スキップ・失敗時の扱い。
 * 実ファイルシステム上の一時ディレクトリで検証する（スキーマ探索と
 * クライアント有無の判定は project-prisma-schema.test.ts 側）。
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prismaGenerateInvocation, ensurePrismaClient } from './project-prisma-client';
import { fingerprintSchemas } from './project-prisma-schema';

let root = '';

function write(rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

/** What a real generate leaves behind; the skip path requires an entrypoint. */
function writeClient(): void {
  write(join('node_modules', '.prisma', 'client', 'index.js'), 'module.exports = {}');
}

const PNPM_CLIENT = join(
  'node_modules',
  '.pnpm',
  '@prisma+client@5.20.0_prisma@5.20.0',
  'node_modules',
  '.prisma',
  'client',
);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prisma-client-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('prismaGenerateInvocation', () => {
  test("prefers the owning package's own generate script", () => {
    write('pnpm-lock.yaml', '');
    write('package.json', '{"name":"r"}');
    write(
      'apps/server/package.json',
      '{"name":"server","scripts":{"db:generate":"prisma generate --schema prisma/schema.prisma"}}',
    );
    write('apps/server/prisma/schema.prisma', 'x');
    expect(prismaGenerateInvocation(root, 'apps/server/prisma/schema.prisma')).toEqual({
      command: 'pnpm run db:generate',
      cwd: join(root, 'apps', 'server'),
      via: 'project-script',
    });
  });

  test('ignores a `generate` script that is not prisma, falling back to prisma exec', () => {
    write('package.json', '{"name":"r","scripts":{"generate":"openapi-typescript spec.yaml"}}');
    write('prisma/schema.prisma', 'x');
    const inv = prismaGenerateInvocation(root, 'prisma/schema.prisma');
    expect(inv.via).toBe('prisma-exec');
    expect(inv.command).toBe('npm exec prisma generate --schema "prisma/schema.prisma"');
  });

  test('accepts a `generate` script that does run prisma', () => {
    write('package.json', '{"name":"r","scripts":{"generate":"prisma generate"}}');
    write('prisma/schema.prisma', 'x');
    expect(prismaGenerateInvocation(root, 'prisma/schema.prisma').via).toBe('project-script');
  });

  test('uses the package manager the project actually declares', () => {
    write('bun.lock', '');
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'x');
    expect(prismaGenerateInvocation(root, 'prisma/schema.prisma').command).toBe(
      'bun exec prisma generate --schema "prisma/schema.prisma"',
    );
  });
});

describe('ensurePrismaClient', () => {
  test('does nothing for a project with no schema', async () => {
    write('package.json', '{}');
    const run = mock(() => Promise.resolve());
    expect((await ensurePrismaClient(root, { run })).action).toBe('skipped');
    expect(run).not.toHaveBeenCalled();
  });

  test('generates once, then skips while the schema is unchanged', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => {
      writeClient();
      return Promise.resolve();
    });

    expect((await ensurePrismaClient(root, { run })).action).toBe('generated');
    expect((await ensurePrismaClient(root, { run })).action).toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('skips when the client is only in the pnpm store', async () => {
    write('pnpm-lock.yaml', '');
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => {
      write(join(PNPM_CLIENT, 'index.js'), 'module.exports = {}');
      return Promise.resolve();
    });

    expect((await ensurePrismaClient(root, { run })).action).toBe('generated');
    expect((await ensurePrismaClient(root, { run })).action).toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('regenerates after the schema changes', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => {
      writeClient();
      return Promise.resolve();
    });
    await ensurePrismaClient(root, { run });
    write('prisma/schema.prisma', 'model A { id Int @id\n name String }');
    expect((await ensurePrismaClient(root, { run })).action).toBe('generated');
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('regenerates when the fingerprint matches but the client was deleted', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    let makeClient = true;
    const run = mock(() => {
      if (makeClient) writeClient();
      return Promise.resolve();
    });
    await ensurePrismaClient(root, { run });
    rmSync(join(root, 'node_modules', '.prisma'), { recursive: true, force: true });
    makeClient = false;
    expect((await ensurePrismaClient(root, { run })).action).toBe('generated');
  });

  test('generates for a workspace root that has no node_modules of its own', async () => {
    // The fingerprint lives under root/node_modules, which does not exist here;
    // writing into a missing directory threw ENOENT and silently cost the skip.
    write('package.json', '{"name":"r"}');
    write('apps/server/package.json', '{"name":"s"}');
    write('apps/server/prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => {
      write(join('apps', 'server', 'node_modules', '.prisma', 'client', 'index.js'), 'x');
      return Promise.resolve();
    });

    expect((await ensurePrismaClient(root, { run })).action).toBe('generated');
    expect((await ensurePrismaClient(root, { run })).action).toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('fails SOFT when generate exits non-zero — never throws', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => Promise.reject(new Error('P1012 schema error')));
    const result = await ensurePrismaClient(root, { run });
    expect(result.action).toBe('failed');
    // No fingerprint is recorded, so the next launch retries rather than
    // treating a failed generate as done.
    expect(existsSync(join(root, 'node_modules', '.rapitas-prisma-fingerprint'))).toBe(false);
  });

  test('says the existing client was kept when one is present', async () => {
    // The measured temporaid state: a client from an earlier generate, and a
    // regenerate that cannot replace it because the engine DLL is locked.
    write('pnpm-lock.yaml', '');
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    write(join(PNPM_CLIENT, 'index.js'), 'module.exports = {}');
    const run = mock(() => Promise.reject(new Error('EPERM: operation not permitted, unlink')));

    const result = await ensurePrismaClient(root, { run });
    expect(result.action).toBe('failed');
    expect(result.detail).toContain('existing client kept');
  });

  test('says the gates will be unverifiable when no client exists', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => Promise.reject(new Error('P1012')));
    expect((await ensurePrismaClient(root, { run })).detail).toContain('unverifiable');
  });

  test('records the fingerprint of the schema it actually generated from', async () => {
    write('package.json', '{"name":"r"}');
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const run = mock(() => {
      writeClient();
      return Promise.resolve();
    });
    await ensurePrismaClient(root, { run });
    const recorded = readFileSync(
      join(root, 'node_modules', '.rapitas-prisma-fingerprint'),
      'utf8',
    ).trim();
    expect(recorded).toBe(fingerprintSchemas(root, ['prisma/schema.prisma']));
  });
});
