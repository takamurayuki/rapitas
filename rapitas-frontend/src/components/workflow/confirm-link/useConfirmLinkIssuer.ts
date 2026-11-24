'use client';

/**
 * useConfirmLinkIssuer
 *
 * State for the external confirm-link issuer (task 1430): loads the task's
 * links and resources, issues a link, and toggles a resource's 「外部公開可」
 * flag. Every request carries X-Rapitas-Source: ui because the backend only
 * lets a human issue links or change what is public.
 */
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { UI_SOURCE_HEADER, UI_SOURCE_VALUE } from '@/lib/api-headers';

/** One resource of the task with its public flag. */
export interface ConfirmLinkResource {
  id: number;
  title: string;
  externalPublic: boolean;
}

/** The link just issued. */
export interface IssuedConfirmLink {
  linkId: string;
  url: string;
  expiresAt: number;
  relative: boolean;
}

/** Hook result. */
export interface UseConfirmLinkIssuerResult {
  enabled: boolean;
  resources: ConfirmLinkResource[];
  issued: IssuedConfirmLink | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  load: () => Promise<void>;
  issue: (message: string) => Promise<void>;
  setPublic: (resourceId: number, externalPublic: boolean) => Promise<void>;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  [UI_SOURCE_HEADER]: UI_SOURCE_VALUE,
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return body?.code ?? body?.error ?? `HTTP ${res.status}`;
}

/**
 * @param taskId - Task whose pending question the link answers / 対象タスク
 * @returns Issuer state and actions / 発行UIの状態と操作
 */
export function useConfirmLinkIssuer(taskId: number): UseConfirmLinkIssuerResult {
  const [enabled, setEnabled] = useState(true);
  const [resources, setResources] = useState<ConfirmLinkResource[]>([]);
  const [issued, setIssued] = useState<IssuedConfirmLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/confirm-links`, {
        headers: { [UI_SOURCE_HEADER]: UI_SOURCE_VALUE },
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { enabled?: boolean; resources?: ConfirmLinkResource[] };
      setEnabled(body.enabled !== false);
      setResources(body.resources ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const issue = useCallback(
    async (message: string) => {
      setBusy(true);
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/confirm-links`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ message }),
        });
        if (!res.ok) throw new Error(await readError(res));
        setIssued((await res.json()) as IssuedConfirmLink);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [taskId],
  );

  const setPublic = useCallback(async (resourceId: number, externalPublic: boolean) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/workflow/confirm-links/resources/${resourceId}/visibility`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ externalPublic }) },
      );
      if (!res.ok) throw new Error(await readError(res));
      setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, externalPublic } : r)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { enabled, resources, issued, loading, busy, error, load, issue, setPublic };
}
