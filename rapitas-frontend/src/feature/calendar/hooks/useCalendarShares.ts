'use client';
/**
 * useCalendarShares
 *
 * Who I let see my month calendar, and whose I may see (#1270).
 *
 * Every call sends `credentials: 'include'`. The rest of this app's reads do
 * not, because the backend serves sessionless requests unscoped on purpose —
 * but these endpoints answer 401 without a session, so a fetch that drops the
 * cookie makes the whole feature look broken rather than unauthenticated.
 *
 * Not responsible for reading anyone's events — see useSharedSchedules.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useCalendarShares');

/** A person on either side of a share. */
export interface SharePerson {
  workspaceId: number;
  username: string;
  email: string | null;
}

/** Why a grant did not happen, as the routes report it. */
export type GrantFailure = 'no_session' | 'unknown_person' | 'self' | 'failed';

export interface CalendarSharesState {
  /** People who can see my calendar. */
  sharedByMe: SharePerson[];
  /** People whose calendar I can see. */
  sharedWithMe: SharePerson[];
  loading: boolean;
  /** True once a load has failed; the lists stay as they were. */
  failed: boolean;
  reload: () => Promise<void>;
  grant: (identifier: string) => Promise<{ ok: true } | { ok: false; reason: GrantFailure }>;
  revoke: (workspaceId: number) => Promise<boolean>;
}

/**
 * Load both directions of calendar sharing, with grant and revoke.
 *
 * @returns The two lists, their loading state, and the two mutations / 2方向の一覧・状態・操作
 */
export function useCalendarShares(): CalendarSharesState {
  const [sharedByMe, setSharedByMe] = useState<SharePerson[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/calendar-shares`, { credentials: 'include' });
      if (!res.ok) {
        // 401 is the ordinary answer with no session: nothing is shared and
        // nothing is wrong, so the lists stay empty without an error.
        setFailed(res.status !== 401);
        setSharedByMe([]);
        setSharedWithMe([]);
        return;
      }
      const body = (await res.json()) as {
        sharedByMe?: SharePerson[];
        sharedWithMe?: SharePerson[];
      };
      setSharedByMe(body.sharedByMe ?? []);
      setSharedWithMe(body.sharedWithMe ?? []);
      setFailed(false);
    } catch (e) {
      logger.error('Failed to load calendar shares:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grant = useCallback(
    async (identifier: string) => {
      try {
        const res = await fetch(`${API_BASE_URL}/calendar-shares`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { reason?: GrantFailure };
          return { ok: false as const, reason: body.reason ?? 'failed' };
        }
        await reload();
        return { ok: true as const };
      } catch (e) {
        logger.error('Failed to grant calendar access:', e);
        return { ok: false as const, reason: 'failed' as const };
      }
    },
    [reload],
  );

  const revoke = useCallback(
    async (workspaceId: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/calendar-shares/${workspaceId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) return false;
        await reload();
        return true;
      } catch (e) {
        logger.error('Failed to revoke calendar access:', e);
        return false;
      }
    },
    [reload],
  );

  return { sharedByMe, sharedWithMe, loading, failed, reload, grant, revoke };
}
