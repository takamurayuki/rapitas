import { existsSync, readFileSync } from 'fs';
import { copyFile, mkdir, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import { Database } from 'bun:sqlite';
import { SQLITE_INIT_SQL } from '../src/generated/sqlite-init-sql';

type AnyRow = Record<string, unknown>;
type PrismaLike = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
};

type MigrationOptions = {
  postgresUrl: string;
  sqliteUrl: string;
  dryRun: boolean;
  overwrite: boolean;
  includeExecutionLogs: boolean;
  skipPrismaGenerate: boolean;
};

type MigrationStats = {
  table: string;
  read: number;
  written: number;
  skipped: boolean;
};

const SKIPPED_TABLES_BY_DEFAULT = new Set(['AgentExecutionLog']);
const PROVIDER_SECRET_FIELDS: Record<string, string> = {
  claudeApiKeyEncrypted: 'claude',
  chatgptApiKeyEncrypted: 'chatgpt',
  geminiApiKeyEncrypted: 'gemini',
};

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function loadLocalEnv(): void {
  const envPath = resolve(import.meta.dir, '..', '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

export function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('SQLite database URL must start with file:');
  }

  return resolve(databaseUrl.slice('file:'.length));
}

export function parseCreateTableOrder(sql: string): string[] {
  return [...sql.matchAll(/CREATE TABLE\s+"([^"]+)"/g)].map((match) => match[1]);
}

export function normalizeSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const constructorName = value.constructor?.name;
    if (constructorName === 'Decimal' && typeof value.toString === 'function') {
      return value.toString();
    }
    if (Buffer.isBuffer(value)) return value;
    return JSON.stringify(value);
  }

  return value;
}

export async function migrateSecretFields(row: AnyRow): Promise<AnyRow> {
  const migrated = { ...row };
  const { resolveStoredSecret, saveAgentApiKey, saveProviderApiKey } =
    await import('../utils/common/secret-store');

  if (typeof migrated.id === 'number' && typeof migrated.apiKeyEncrypted === 'string') {
    const secret = resolveStoredSecret(migrated.apiKeyEncrypted);
    migrated.apiKeyEncrypted = secret ? saveAgentApiKey(migrated.id, secret) : null;
  }

  for (const [field, provider] of Object.entries(PROVIDER_SECRET_FIELDS)) {
    if (typeof migrated[field] !== 'string') continue;

    const secret = resolveStoredSecret(migrated[field]);
    migrated[field] = secret ? saveProviderApiKey(provider, secret) : null;
  }

  return migrated;
}

export function insertRows(
  database: Database,
  table: string,
  columns: string[],
  rows: AnyRow[],
): number {
  if (rows.length === 0 || columns.length === 0) return 0;

  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const statement = database.prepare(
    `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,
  );

  const insertMany = database.transaction((items: AnyRow[]) => {
    for (const row of items) {
      const values = columns.map((column) => normalizeSqliteValue(row[column])) as any[];
      statement.run(...values);
    }
  });

  insertMany(rows);
  return rows.length;
}

function getOptions(): MigrationOptions {
  const envPostgresUrl = process.env.POSTGRES_DATABASE_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const postgresUrl =
    readOption('--postgres-url') ||
    envPostgresUrl ||
    (databaseUrl && !databaseUrl.startsWith('file:') ? databaseUrl : undefined);

  const sqliteUrl =
    readOption('--sqlite-url') ||
    process.env.SQLITE_DATABASE_URL ||
    'file:../rapitas-desktop/.data/rapitas-dev.db';

  if (!postgresUrl) {
    throw new Error(
      'PostgreSQL source is required. Set POSTGRES_DATABASE_URL or pass --postgres-url.',
    );
  }

  return {
    postgresUrl,
    sqliteUrl,
    dryRun: hasArg('--dry-run') || process.env.MIGRATION_DRY_RUN === '1',
    overwrite: hasArg('--overwrite') || process.env.MIGRATION_OVERWRITE === '1',
    includeExecutionLogs:
      hasArg('--include-execution-logs') || process.env.MIGRATE_EXECUTION_LOGS === 'true',
    skipPrismaGenerate:
      hasArg('--skip-prisma-generate') || process.env.SKIP_PRISMA_GENERATE === '1',
  };
}

function ensurePostgresClientGenerated(skip: boolean): void {
  if (skip) return;

  const result = Bun.spawnSync(['bunx', 'prisma', 'generate', '--schema', 'prisma/schema'], {
    cwd: import.meta.dir + '/..',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (!result.success) {
    throw new Error(
      'Failed to generate PostgreSQL Prisma Client. Stop running backend processes and retry, or pass --skip-prisma-generate if it is already generated for PostgreSQL.',
    );
  }
}

async function createPostgresClient(postgresUrl: string): Promise<PrismaLike> {
  process.env.RAPITAS_DB_PROVIDER = 'postgresql';
  process.env.DATABASE_URL = postgresUrl;

  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient() as PrismaLike;
}

async function prepareSqliteTarget(options: MigrationOptions): Promise<Database | null> {
  const sqlitePath = sqlitePathFromDatabaseUrl(options.sqliteUrl);

  if (options.dryRun) {
    console.info(`[dry-run] SQLite target: ${sqlitePath}`);
    return null;
  }

  await mkdir(dirname(sqlitePath), { recursive: true });

  if (existsSync(sqlitePath)) {
    const backupPath = `${sqlitePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(sqlitePath, backupPath);
    console.info(`Created SQLite backup: ${backupPath}`);

    if (!options.overwrite) {
      throw new Error(
        'SQLite target already exists. Re-run with --overwrite after confirming the backup.',
      );
    }

    await unlink(sqlitePath);
  }

  process.env.RAPITAS_DB_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = options.sqliteUrl;

  const database = new Database(sqlitePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = OFF;');
  database.exec(SQLITE_INIT_SQL);

  return database;
}

function getSqliteColumns(database: Database, table: string): string[] {
  const rows = database.query<{ name: string }, []>(`PRAGMA table_info("${table}")`).all();
  return rows.map((row) => row.name);
}

async function fetchPostgresRows(client: PrismaLike, table: string): Promise<AnyRow[]> {
  const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    table,
  );
  if (columns.length === 0) return [];

  const hasId = columns.some((column) => column.column_name === 'id');
  const orderBy = hasId ? ' ORDER BY "id"' : '';
  return client.$queryRawUnsafe<AnyRow[]>(`SELECT * FROM "${table}"${orderBy}`);
}

async function migrateTable(
  client: PrismaLike,
  database: Database | null,
  table: string,
  options: MigrationOptions,
): Promise<MigrationStats> {
  const shouldSkip = !options.includeExecutionLogs && SKIPPED_TABLES_BY_DEFAULT.has(table);
  if (shouldSkip) {
    const rows = await fetchPostgresRows(client, table);
    return { table, read: rows.length, written: 0, skipped: true };
  }

  const rows = await fetchPostgresRows(client, table);
  if (!database || options.dryRun) {
    return { table, read: rows.length, written: 0, skipped: false };
  }

  const columns = getSqliteColumns(database, table);
  const filteredRows = await Promise.all(
    rows.map(async (row) => migrateSecretFields(filterRowColumns(row, columns))),
  );
  const written = insertRows(database, table, columns, filteredRows);

  return { table, read: rows.length, written, skipped: false };
}

function filterRowColumns(row: AnyRow, columns: string[]): AnyRow {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

function finalizeSqlite(database: Database): void {
  database.exec('PRAGMA foreign_keys = ON;');
  const violations = database.query('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(`SQLite foreign key check failed: ${JSON.stringify(violations.slice(0, 10))}`);
  }
  database.exec('PRAGMA optimize;');
}

async function runMigration(): Promise<void> {
  loadLocalEnv();

  const options = getOptions();
  const tables = parseCreateTableOrder(SQLITE_INIT_SQL);

  ensurePostgresClientGenerated(options.skipPrismaGenerate);
  const client = await createPostgresClient(options.postgresUrl);
  const database = await prepareSqliteTarget(options);

  const stats: MigrationStats[] = [];
  try {
    for (const table of tables) {
      const stat = await migrateTable(client, database, table, options);
      stats.push(stat);
      const action = stat.skipped ? 'skipped' : options.dryRun ? 'checked' : 'migrated';
      console.info(`${action}: ${table} (${stat.read} rows)`);
    }

    if (database && !options.dryRun) {
      finalizeSqlite(database);
    }
  } finally {
    database?.close();
    await client.$disconnect();
  }

  const read = stats.reduce((sum, stat) => sum + stat.read, 0);
  const written = stats.reduce((sum, stat) => sum + stat.written, 0);
  console.info(`Migration complete. read=${read}, written=${written}, dryRun=${options.dryRun}`);
}

if (import.meta.main) {
  runMigration().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
