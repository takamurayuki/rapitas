/**
 * WorkspaceProvisioning
 *
 * Creates workspaces and attaches users to them. Every account needs a
 * workspace the moment it exists, or it signs in to a scope that resolves to
 * null and silently sees everything.
 *
 * NOT responsible for resolving a request to a workspace (session-workspace)
 * or for moving existing rows into one (the backfill script).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { runAcrossAllWorkspaces } from './workspace-context';

const log = createLogger('tenancy:provisioning');

/** A workspace as this module reports it. */
interface WorkspaceRow {
  id: number;
  slug: string;
  name: string;
}

/**
 * The client surface provisioning needs.
 *
 * Injected rather than reached for, following tenancy.routes.ts: the
 * alternative is `mock.module` on the Prisma client, which bun applies
 * process-wide to every other test file in the run. Production passes nothing
 * and gets the real client.
 */
export interface ProvisioningDb {
  workspace: {
    findUnique: (a: { where: { slug: string } }) => Promise<{ id: number } | null>;
    findFirst: (a: {
      where: { isDefault: boolean };
      select: { id: true; slug: true };
    }) => Promise<{ id: number; slug: string } | null>;
    create: (a: {
      data: Record<string, unknown>;
      select: Record<string, true>;
    }) => Promise<WorkspaceRow>;
  };
  workspaceMember: {
    findFirst: (a: {
      where: { userId: number };
      orderBy: { id: 'asc' };
      select: { workspace: { select: { id: true; slug: true; name: true } } };
    }) => Promise<{ workspace: WorkspaceRow | null } | null>;
  };
}

/** The real client, structurally narrowed to what this module uses. */
const defaultDb = (): ProvisioningDb => prisma as unknown as ProvisioningDb;

/** Turn a username into a slug that is stable, readable and URL-safe. */
function slugify(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'workspace' : cleaned.slice(0, 40);
}

/**
 * A slug nothing else is using, by appending -2, -3 … to `base`.
 *
 * @param base - Preferred slug / 希望するスラッグ
 * @returns An unused slug / 未使用のスラッグ
 */
async function uniqueSlug(base: string, db: ProvisioningDb): Promise<string> {
  // Unscoped: Workspace is exempt from scoping, but being explicit keeps this
  // correct if that ever changes.
  return runAcrossAllWorkspaces(async () => {
    let candidate = base;
    for (let n = 2; n < 1000; n++) {
      const taken = await db.workspace.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
      candidate = `${base}-${n}`;
    }
    // 998 collisions on one name is not a case worth a fallback that could
    // itself collide; a unique suffix ends it.
    return `${base}-${Date.now()}`;
  });
}

/**
 * Give `userId` a workspace of its own and make them its owner.
 *
 * Idempotent per user: a user who already belongs to one keeps it, so a
 * re-registration or a replayed request cannot split their data in two.
 *
 * @param userId - The account to provision / 対象アカウント
 * @param name - Display name for the workspace / ワークスペース表示名
 * @returns The workspace the user now belongs to / 所属することになったワークスペース
 */
export async function ensureWorkspaceForUser(
  userId: number,
  name: string,
  db: ProvisioningDb = defaultDb(),
): Promise<{ id: number; slug: string; name: string }> {
  return runAcrossAllWorkspaces(async () => {
    const existing = await db.workspaceMember.findFirst({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { workspace: { select: { id: true, slug: true, name: true } } },
    });
    if (existing?.workspace) return existing.workspace;

    const slug = await uniqueSlug(slugify(name), db);
    const workspace = await db.workspace.create({
      data: {
        slug,
        name,
        members: { create: { userId, role: 'owner' } },
      },
      select: { id: true, slug: true, name: true },
    });
    log.info({ userId, workspaceId: workspace.id, slug }, 'provisioned a workspace for a new user');
    return workspace;
  });
}

/**
 * The workspace every pre-tenancy row belongs to, created on first call.
 *
 * Used by the backfill and by anything that needs somewhere to put rows that
 * existed before accounts did.
 *
 * @returns The default workspace / 既定ワークスペース
 */
export async function ensureDefaultWorkspace(
  db: ProvisioningDb = defaultDb(),
): Promise<{ id: number; slug: string }> {
  return runAcrossAllWorkspaces(async () => {
    const found = await db.workspace.findFirst({
      where: { isDefault: true },
      select: { id: true, slug: true },
    });
    if (found) return found;
    const created = await db.workspace.create({
      data: { slug: await uniqueSlug('default', db), name: '既定', isDefault: true },
      select: { id: true, slug: true },
    });
    log.info({ workspaceId: created.id }, 'created the default workspace');
    return created;
  });
}
