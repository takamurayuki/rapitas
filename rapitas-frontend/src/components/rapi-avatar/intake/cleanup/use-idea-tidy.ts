'use client';
/**
 * use-idea-tidy
 *
 * State for ラピ's idea-box tidy: the proposal, what is still ticked, applying
 * it and undoing it. Not responsible for the proposal rules (the server's
 * services/memory/idea-tidy.ts) or for drawing (`IdeaTidy`).
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** A group of near-duplicate ideas and the one kept. */
export interface IdeaDuplicateGroup {
  keepId: number;
  ideas: Array<{ id: number; title: string; priority: string }>;
}

/** An idea offered to put away. */
export interface UnneededIdea {
  id: number;
  title: string;
  reason: 'used' | 'stale';
}

/** What an applied tidy changed; sent back to undo it. */
export interface IdeaTidyDone {
  archivedIds: number[];
  previousContents: Array<{ id: number; content: string }>;
}

/**
 * @returns Proposal, selection and the apply / undo actions / 提案・選択・適用と取り消し
 */
export function useIdeaTidy() {
  const [loading, setLoading] = useState(true);
  const [duplicates, setDuplicates] = useState<IdeaDuplicateGroup[]>([]);
  const [unneeded, setUnneeded] = useState<UnneededIdea[]>([]);
  const [groupsOn, setGroupsOn] = useState<Set<number>>(new Set());
  const [ideasOn, setIdeasOn] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<IdeaTidyDone | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/idea-box/tidy/proposal`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        duplicates: IdeaDuplicateGroup[];
        unneeded: UnneededIdea[];
      };
      setDuplicates(body.duplicates);
      setUnneeded(body.unneeded);
      // Everything proposed starts ticked; what is applied is what is still ticked.
      setGroupsOn(new Set(body.duplicates.map((g) => g.keepId)));
      setIdeasOn(new Set(body.unneeded.map((u) => u.id)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = (set: Set<number>, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const apply = async () => {
    setWorking(true);
    setError(false);
    try {
      const merges = duplicates
        .filter((g) => groupsOn.has(g.keepId))
        .map((g) => ({
          keepId: g.keepId,
          mergeIds: g.ideas.filter((i) => i.id !== g.keepId).map((i) => i.id),
        }));
      const res = await fetch(`${API_BASE_URL}/idea-box/tidy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merges, archiveIds: [...ideasOn] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as IdeaTidyDone;
      setDone({ archivedIds: body.archivedIds, previousContents: body.previousContents });
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  const undo = async () => {
    if (!done) return;
    setWorking(true);
    try {
      const res = await fetch(`${API_BASE_URL}/idea-box/tidy/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(done),
      });
      if (!res.ok) throw new Error(String(res.status));
      setUndone(true);
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  return {
    loading,
    duplicates,
    unneeded,
    groupsOn,
    ideasOn,
    toggleGroup: (keepId: number) => setGroupsOn((s) => flip(s, keepId)),
    toggleIdea: (id: number) => setIdeasOn((s) => flip(s, id)),
    working,
    done,
    undone,
    error,
    apply,
    undo,
  };
}
