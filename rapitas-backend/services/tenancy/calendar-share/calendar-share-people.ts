/**
 * calendar-share-people
 *
 * Maps between the person a user types in and the workspace a grant is
 * actually recorded against, and back again for display.
 *
 * NOT responsible for creating grants or deciding access. Takes its database
 * handle as a parameter so the matching rules are driven by tests rather than
 * inferred from a live table.
 */
import { prisma } from '../../../config/database';
import { runAcrossAllWorkspaces } from '../workspace-context';

/** A person's public identity, as shown in the calendar's person picker. */
export interface PersonLabel {
  username: string;
  email: string | null;
}

/** A resolved person, together with the workspace their calendar lives in. */
export interface ResolvedPerson extends PersonLabel {
  workspaceId: number;
  userId: number;
}

/** The slice of the client this module uses. */
export interface PeopleDb {
  user: {
    findFirst(args: {
      where: { OR: ({ username: string } | { email: string })[] };
      select?: unknown;
    }): Promise<{ id: number; username: string; email: string | null } | null>;
  };
  workspaceMember: {
    findFirst(args: {
      where: { userId: number };
      orderBy?: { id: 'asc' | 'desc' };
      select?: unknown;
    }): Promise<{ workspaceId: number } | null>;
    findMany(args: {
      where: { workspaceId: { in: number[] } };
      orderBy?: { id: 'asc' | 'desc' };
      select?: unknown;
    }): Promise<{ workspaceId: number; user: PersonLabel }[]>;
  };
}

/** The live client, narrowed to what this module needs. */
export function defaultPeopleDb(): PeopleDb {
  return prisma as unknown as PeopleDb;
}

/**
 * Find the workspace whose calendar belongs to the named person.
 *
 * Returns null rather than guessing in three cases that all used to end in
 * sharing the wrong calendar: a blank identifier (which would match a row
 * whose email is the empty string), an unknown person, and a person with no
 * workspace of their own. That last one must never fall back to the default
 * workspace — the default owns every pre-tenancy row, so a grant on it would
 * expose the entire original pile.
 *
 * Matching is exact. Case-insensitive email matching would need Prisma's
 * `mode: 'insensitive'`, which the SQLite provider this app ships on does not
 * support, and a filter that silently works on one provider and not the other
 * is worse than one that always behaves the same.
 *
 * @param db - Narrowed client / 絞り込んだクライアント
 * @param identifier - A username or email address as typed / 入力されたユーザー名またはメールアドレス
 * @returns The person and their workspace, or null / 本人とワークスペース、無ければ null
 */
export async function resolvePersonWorkspace(
  db: PeopleDb,
  identifier: string,
): Promise<ResolvedPerson | null> {
  const needle = identifier.trim();
  if (needle === '') return null;
  return runAcrossAllWorkspaces(async () => {
    const user = await db.user.findFirst({
      where: { OR: [{ username: needle }, { email: needle }] },
      select: { id: true, username: true, email: true },
    });
    if (!user) return null;
    const membership = await db.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
      select: { workspaceId: true },
    });
    if (!membership) return null;
    return {
      workspaceId: membership.workspaceId,
      userId: user.id,
      username: user.username,
      email: user.email,
    };
  });
}

/**
 * Label each workspace with the person who owns it, for the person picker.
 *
 * A workspace with no member is omitted rather than given a placeholder name:
 * showing "（不明）" next to a live grant invites someone to leave access
 * granted to an account they can no longer identify.
 *
 * @param db - Narrowed client / 絞り込んだクライアント
 * @param workspaceIds - Workspaces to label / ラベルを付けるワークスペース
 * @returns Labels by workspace id / ワークスペースIDごとのラベル
 */
export async function describePeople(
  db: PeopleDb,
  workspaceIds: number[],
): Promise<Map<number, PersonLabel>> {
  const labels = new Map<number, PersonLabel>();
  if (workspaceIds.length === 0) return labels;
  const members = await runAcrossAllWorkspaces(() =>
    db.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: { id: 'asc' },
      select: { workspaceId: true, user: { select: { username: true, email: true } } },
    }),
  );
  for (const member of members) {
    // First member wins: `orderBy id asc` makes that the owner created with
    // the workspace, not whoever was added later.
    if (!labels.has(member.workspaceId)) labels.set(member.workspaceId, member.user);
  }
  return labels;
}
