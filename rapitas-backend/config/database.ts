/**
 * Database Configuration
 *
 * Prisma client initialization. Supports PostgreSQL (web) and SQLite (desktop)
 * selected by DATABASE_URL.
 */
import { createLogger } from './logger';
import { dbProvider, resolvePrismaClientCtor } from './prisma-client-resolver';
import { getOwnedModels } from '../services/tenancy/owned-models';
import {
  createWorkspaceExtension,
  type BaseClientLike,
} from '../services/tenancy/workspace-extension';

const log = createLogger('database');
log.info(`Connecting to ${dbProvider}`);

const PrismaClient = resolvePrismaClientCtor();

const baseClient = new PrismaClient();

/**
 * The client every caller uses, with workspace scoping applied.
 *
 * INERT until stage 3: nothing calls runInWorkspace yet, so the extension sees
 * no workspace and passes every call through unchanged. Wiring it now rather
 * than later means the chokepoint is in the live path before anything depends
 * on it, instead of arriving as a "built but never connected" layer.
 *
 * `baseClient` is handed to the extension so a unique read can be re-issued as
 * findFirst without re-entering the hook — see workspace-extension.
 *
 * NOTE: the cast back to `typeof baseClient` is deliberate. `$extends` returns
 * a structurally different type, and ~142 modules annotate parameters as
 * `PrismaClient`; without the cast every one of them would have to change for
 * a layer that adds no new surface — the extension only rewrites arguments,
 * so the delegates are the same at runtime. Revisit if an extension ever adds
 * a method callers need to see.
 */
export const prisma = baseClient.$extends(
  createWorkspaceExtension(getOwnedModels(), baseClient as unknown as BaseClientLike),
) as unknown as typeof baseClient;

/**
 * Verify DB connection and retry until successful.
 * Called before server startup to prevent receiving requests while DB is disconnected.
 */
export async function ensureDatabaseConnection(maxRetries = 5, retryDelayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      log.info(`${dbProvider} connection established`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) {
        log.error(
          { err: error, maxRetries },
          `Failed to connect after ${maxRetries} attempts: ${message}`,
        );
        throw error;
      }
      log.warn(
        { attempt, maxRetries, retryDelayMs },
        `Connection attempt ${attempt}/${maxRetries} failed: ${message}. Retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
