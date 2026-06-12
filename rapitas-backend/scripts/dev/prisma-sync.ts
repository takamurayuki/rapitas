/**
 * Prisma Sync
 *
 * Provider-aware Prisma schema synchronization for the dev watcher.
 * Resolves the active datasource provider (SQLite vs PostgreSQL), regenerates
 * the SQLite schema folder when needed, and runs `prisma db push` / `generate`
 * with `RAPITAS_DB_PROVIDER` set so prisma.config.ts selects the matching
 * schema. This module is NOT responsible for runtime DB connections — only for
 * keeping the dev database schema in sync with `prisma/schema`.
 *
 * NOTE: This exists because the previous inline `bunx prisma db push` calls in
 * dev.ts / watcher.ts did not pass a provider. With a `file:` DATABASE_URL,
 * prisma.config.ts defaulted to the PostgreSQL schema, the push failed on the
 * provider/URL mismatch, and the non-zero exit was swallowed — so new columns
 * silently never reached the SQLite dev DB. See docs/design/dev-schema-sync.md.
 */
import { spawn } from 'bun';
import { join } from 'path';
import { ROOT_DIR, log } from './server-manager';

/** Prisma datasource providers supported by the dev environment. */
export type DbProvider = 'sqlite' | 'postgresql';

/** Relative path (from ROOT_DIR) of the SQLite schema generator script. */
const SQLITE_SCHEMA_GENERATOR = 'scripts/generate-sqlite-prisma-schema.cjs';

/**
 * Resolves the active Prisma datasource provider for dev schema sync.
 *
 * Resolution order: an explicit `RAPITAS_DB_PROVIDER` wins; otherwise a
 * `file:`-prefixed `DATABASE_URL` implies SQLite; everything else is treated as
 * PostgreSQL. This MUST mirror prisma.config.ts so `db push` targets the same
 * schema the server actually connects to.
 *
 * @returns Resolved provider / 解決されたプロバイダ
 */
export function resolveDbProvider(): DbProvider {
  const explicit = process.env.RAPITAS_DB_PROVIDER?.trim().toLowerCase();
  if (explicit === 'sqlite' || explicit === 'postgresql') return explicit;
  if (process.env.DATABASE_URL?.startsWith('file:')) return 'sqlite';
  return 'postgresql';
}

/**
 * Normalizes a subprocess exit code, treating null (signal-killed / timed-out
 * processes) as failure instead of success.
 *
 * Bun's `spawn` sets `exitCode` to null when the process is terminated by a
 * signal rather than by a normal exit. Returning `null ?? 0` would silently
 * treat a SIGKILL or OOM-kill as success and swallow schema errors. This
 * function returns 1 for any null exit code so that the failure is propagated.
 *
 * @param exitCode - Raw exit code from the subprocess / サブプロセスの生の終了コード
 * @param signalCode - Signal name if the process was killed, otherwise null / プロセスが終了シグナルで停止した場合のシグナル名
 * @returns Normalized exit code; 0 = success, non-zero = failure / 正規化された終了コード（0は成功、非0は失敗）
 */
export function normalizeExitCode(exitCode: number | null, signalCode?: string | null): number {
  if (exitCode !== null) return exitCode;
  // NOTE: null means the process was killed or timed out — treat as failure (1).
  // Returning 0 here would silently swallow prisma schema errors / OOM kills.
  return 1;
}

/**
 * Spawns a command inheriting the dev environment with `RAPITAS_DB_PROVIDER`
 * pinned to the resolved provider, and returns its normalized exit code.
 *
 * null exit codes (signal-terminated / killed processes) are normalized to 1
 * (failure) via `normalizeExitCode` so that schema errors and unexpected
 * process terminations are never silently treated as success.
 *
 * @param cmd - Command and arguments to run / 実行するコマンドと引数
 * @param provider - Provider to pin for the subprocess / サブプロセスに固定するプロバイダ
 * @returns Normalized process exit code (0 = success, non-zero = failure) / 正規化されたプロセス終了コード（0は成功、非0は失敗）
 */
async function run(cmd: string[], provider: DbProvider): Promise<number> {
  const proc = spawn({
    cmd,
    cwd: ROOT_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    // Bun replaces the env entirely when `env` is set, so spread process.env.
    env: { ...process.env, RAPITAS_DB_PROVIDER: provider },
  });
  await proc.exited;
  if (proc.signalCode) {
    log.warn(`prisma subprocess killed by signal: ${proc.signalCode}`);
  }
  return normalizeExitCode(proc.exitCode, proc.signalCode);
}

/**
 * Regenerates `prisma/schema.desktop` from the canonical `prisma/schema`
 * source. The desktop schema is a build artifact (provider swapped to SQLite,
 * `@db.Decimal` stripped); editing only `prisma/schema` would otherwise never
 * reach the SQLite dev DB.
 *
 * @returns True if regeneration succeeded / 再生成が成功した場合 true
 */
async function regenerateSqliteSchema(provider: DbProvider): Promise<boolean> {
  log.info('Regenerating SQLite schema from prisma/schema...');
  const code = await run(['bun', 'run', join(ROOT_DIR, SQLITE_SCHEMA_GENERATOR)], provider);
  if (code !== 0) {
    log.error(`SQLite schema generation FAILED (exit ${code}). Aborting db push.`);
    return false;
  }
  return true;
}

/**
 * Synchronizes the dev database schema for the active provider.
 *
 * SQLite:    regenerate schema.desktop → `db push --skip-generate` → (generate)
 * PostgreSQL: `db push --skip-generate` → (generate)
 *
 * Unlike the previous inline calls, the provider is pinned and every step's
 * exit code is checked. On `db push` failure a loud, actionable error is logged
 * so schema drift can never again be silently swallowed.
 *
 * @param options.generate - Also run `prisma generate` after a successful push / push 成功後に generate も実行
 * @returns True if the schema is now in sync / スキーマ同期が成功した場合 true
 */
export async function syncDevSchema(options: { generate?: boolean } = {}): Promise<boolean> {
  const provider = resolveDbProvider();

  if (provider === 'sqlite' && !(await regenerateSqliteSchema(provider))) {
    return false;
  }

  log.info(`Running prisma db push (provider=${provider})...`);
  const pushCode = await run(['bunx', 'prisma', 'db', 'push', '--skip-generate'], provider);
  if (pushCode !== 0) {
    log.error(
      `prisma db push FAILED (exit ${pushCode}, provider=${provider}). ` +
        `The dev database schema is OUT OF SYNC — new columns/tables were NOT applied, ` +
        `so API calls touching them will return HTTP 500. Fix the schema error logged ` +
        `above, then re-save a prisma file (or restart) to retry.`,
    );
    return false;
  }

  if (options.generate) {
    log.info(`Running prisma generate (provider=${provider})...`);
    const genCode = await run(['bunx', 'prisma', 'generate'], provider);
    if (genCode !== 0) {
      log.error(`prisma generate FAILED (exit ${genCode}, provider=${provider}).`);
      return false;
    }
  }

  log.success(`Prisma schema in sync (provider=${provider})`);
  return true;
}
