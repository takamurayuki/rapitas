'use client';
/**
 * use-triage-stream
 *
 * State machine for the keyboard-driven triage stream: one-at-a-time queue,
 * delayed commit (the single undo window), confirmation step, and stale-state
 * conflict handling.
 * Not responsible for key listening, rendering, or the HTTP transport.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractApprovalAmount, requiresConfirmation, type TriageItem } from '../_lib/triage-rules';

/** Outcome of a commit request; conflict means a 409 from the server. */
export type TriageCommitResult = 'ok' | 'conflict' | 'error';

/** Transport the hook commits through (injected so it stays testable). */
export interface TriageApi {
  approve: (id: number, expectedUpdatedAt: string) => Promise<TriageCommitResult>;
  reject: (id: number, expectedUpdatedAt: string) => Promise<TriageCommitResult>;
  reload: () => Promise<TriageItem[]>;
}

export type TriageAnnouncementKind =
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'skipped'
  | 'undone'
  | 'undoUnavailable'
  | 'confirmRequired'
  | 'confirmCancelled'
  | 'conflict'
  | 'failed'
  | 'reloaded'
  | 'empty';

export interface TriageAnnouncement {
  /** Increments on every announcement so identical text is re-read. */
  seq: number;
  kind: TriageAnnouncementKind;
  remaining: number;
  politeness: 'polite' | 'assertive';
}

type Last =
  | {
      kind: 'commit';
      op: 'approve' | 'reject';
      item: TriageItem;
      timer: ReturnType<typeof setTimeout>;
    }
  | { kind: 'local'; item: TriageItem };

const DEFAULT_GRACE_MS = 5000;

/**
 * Drive the triage queue.
 *
 * @param options.initialItems - Pending approvals at load time / 取得済み項目
 * @param options.api - Commit/reload transport / 通信
 * @param options.graceMs - Undo window before approve/reject is sent / 取り消し猶予
 */
export function useTriageStream(options: {
  initialItems: TriageItem[];
  api: TriageApi;
  graceMs?: number;
}) {
  const { graceMs = DEFAULT_GRACE_MS } = options;
  const [queue, setQueue] = useState<TriageItem[]>(options.initialItems);
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [announcement, setAnnouncement] = useState<TriageAnnouncement>({
    seq: 0,
    kind: 'empty',
    remaining: options.initialItems.length,
    politeness: 'polite',
  });

  // Mirrors of state so timer callbacks and key handlers see the latest value.
  const queueRef = useRef(queue);
  const lastRef = useRef<Last | null>(null);
  const conflictRef = useRef(false);
  const confirmingRef = useRef(false);
  const seqRef = useRef(0);
  const apiRef = useRef(options.api);
  apiRef.current = options.api;

  const writeQueue = useCallback((next: TriageItem[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const writeConfirming = useCallback((v: boolean) => {
    confirmingRef.current = v;
    setConfirming(v);
  }, []);

  const writeConflict = useCallback((v: boolean) => {
    conflictRef.current = v;
    setConflict(v);
  }, []);

  const announce = useCallback(
    (
      kind: TriageAnnouncementKind,
      remaining: number,
      politeness: 'polite' | 'assertive' = 'polite',
    ) => {
      seqRef.current += 1;
      setAnnouncement({ seq: seqRef.current, kind, remaining, politeness });
    },
    [],
  );

  /** Send an approve/reject; on failure put the item back at the head. */
  const commit = useCallback(
    async (op: 'approve' | 'reject', item: TriageItem) => {
      const result = await apiRef.current[op](item.id, item.updatedAt);
      if (result === 'ok') return;
      writeQueue([item, ...queueRef.current]);
      if (result === 'conflict') {
        writeConflict(true);
        announce('conflict', queueRef.current.length, 'assertive');
      } else {
        announce('failed', queueRef.current.length, 'assertive');
      }
    },
    [announce, writeConflict, writeQueue],
  );

  /** Commit the pending approve/reject now; a new action supersedes the undo window. */
  const flushPending = useCallback(() => {
    const last = lastRef.current;
    if (last?.kind === 'commit') {
      clearTimeout(last.timer);
      lastRef.current = null;
      void commit(last.op, last.item);
    }
  }, [commit]);

  const decide = useCallback(
    (op: 'approve' | 'reject') => {
      const head = queueRef.current[0];
      if (!head || conflictRef.current) return;
      if (
        op === 'approve' &&
        !confirmingRef.current &&
        requiresConfirmation(extractApprovalAmount(head))
      ) {
        writeConfirming(true);
        announce('confirmRequired', queueRef.current.length);
        return;
      }
      writeConfirming(false);
      flushPending();
      const rest = queueRef.current.slice(1);
      writeQueue(rest);
      const timer = setTimeout(() => {
        // The undo window closed: from here the decision is final.
        if (lastRef.current?.kind === 'commit' && lastRef.current.item.id === head.id) {
          lastRef.current = null;
        }
        void commit(op, head);
      }, graceMs);
      lastRef.current = { kind: 'commit', op, item: head, timer };
      announce(op === 'approve' ? 'approved' : 'rejected', rest.length);
    },
    [announce, commit, flushPending, graceMs, writeConfirming, writeQueue],
  );

  const moveToEnd = useCallback(
    (kind: 'deferred' | 'skipped') => {
      const head = queueRef.current[0];
      if (!head || conflictRef.current) return;
      writeConfirming(false);
      flushPending();
      const rest = queueRef.current.slice(1);
      writeQueue([...rest, head]);
      lastRef.current = { kind: 'local', item: head };
      announce(kind, rest.length);
    },
    [announce, flushPending, writeConfirming, writeQueue],
  );

  const undo = useCallback(() => {
    const last = lastRef.current;
    if (!last) {
      announce('undoUnavailable', queueRef.current.length, 'assertive');
      return;
    }
    writeConfirming(false);
    clearTimeout(last.kind === 'commit' ? last.timer : undefined);
    lastRef.current = null;
    writeQueue([last.item, ...queueRef.current.filter((i) => i.id !== last.item.id)]);
    announce('undone', queueRef.current.length);
  }, [announce, writeConfirming, writeQueue]);

  const cancel = useCallback(() => {
    if (!confirmingRef.current) return;
    writeConfirming(false);
    announce('confirmCancelled', queueRef.current.length);
  }, [announce, writeConfirming]);

  const reload = useCallback(async () => {
    flushPending();
    const items = await apiRef.current.reload();
    lastRef.current = null;
    writeConfirming(false);
    writeConflict(false);
    writeQueue(items);
    announce(items.length === 0 ? 'empty' : 'reloaded', items.length);
  }, [announce, flushPending, writeConfirming, writeConflict, writeQueue]);

  // Unmount: do not drop a decision the user already made inside the undo window.
  useEffect(
    () => () => {
      const last = lastRef.current;
      if (last?.kind === 'commit') {
        clearTimeout(last.timer);
        void apiRef.current[last.op](last.item.id, last.item.updatedAt);
      }
    },
    [],
  );

  return {
    current: queue[0] ?? null,
    remaining: queue.length,
    confirming,
    conflict,
    announcement,
    approve: () => decide('approve'),
    reject: () => decide('reject'),
    defer: () => moveToEnd('deferred'),
    next: () => moveToEnd('skipped'),
    undo,
    cancel,
    reload,
  };
}
