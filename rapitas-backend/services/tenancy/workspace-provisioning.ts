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
async function uniqueSlug(base: string): Promise<string> {
  // Unscoped: Workspace is exempt from scoping, but being explicit keeps this
  // correct if that ever changes.
  return runAcrossAllWorkspaces(async () => {
    let candidate = base;
    for (let n = 2; n < 1000; n++) {
      const taken = await prisma.workspace.findUnique({ where: { slug: candidate } });
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
): Promise<{ id: number; slug: string; name: string }> {
  return runAcrossAllWorkspaces(async () => {
    const existing = await prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { workspace: { select: { id: true, slug: true, name: true } } },
    });
    if (existing?.workspace) return existing.workspace;

    const slug = await uniqueSlug(slugify(name));
    const workspace = await prisma.workspace.create({
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
export async function ensureDefaultWorkspace(): Promise<{ id: number; slug: string }> {
  return runAcrossAllWorkspaces(async () => {
    const found = await prisma.workspace.findFirst({
      where: { isDefault: true },
      select: { id: true, slug: true },
    });
    if (found) return found;
    const created = await prisma.workspace.create({
      data: { slug: await uniqueSlug('default'), name: '既定', isDefault: true },
      select: { id: true, slug: true },
    });
    log.info({ workspaceId: created.id }, 'created the default workspace');
    return created;
  });
}
