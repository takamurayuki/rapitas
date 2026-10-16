'use client';

/**
 * TriagePage
 *
 * Keyboard-driven, one-item-at-a-time screen for pending approvals.
 * Wires the triage state machine to key events, the aria-live region and the
 * approvals API. Not responsible for the queue logic (see use-triage-stream).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { API_BASE_URL } from '@/utils/api';
import { useShortcutStore } from '@/stores/shortcut-store';
import { TriageItemCard } from './_components/triage-item-card';
import { DecisionTimerPanel } from './_components/decision-timer-panel';
import { TriageConfirmStep } from './_components/triage-confirm-step';
import { TriageLiveRegion } from './_components/triage-live-region';
import {
  useTriageStream,
  type TriageApi,
  type TriageCommitResult,
} from './_hooks/use-triage-stream';
import {
  resolveTriageKey,
  type TriageAction,
  type TriageItem,
  type TriageKeyBinding,
} from './_lib/triage-rules';

const GRACE_MS = 5000;
const ACTION_BY_ID: Record<string, TriageAction> = {
  triageApprove: 'approve',
  triageDefer: 'defer',
  triageReject: 'reject',
  triageNext: 'next',
};

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

async function fetchPending(): Promise<TriageItem[]> {
  const res = await fetch(`${API_BASE_URL}/approvals?status=pending`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    requestType: String(r.requestType ?? ''),
    title: String(r.title ?? ''),
    proposedChanges: asRecord(r.proposedChanges),
    estimatedChanges: r.estimatedChanges ? asRecord(r.estimatedChanges) : null,
    updatedAt: String(r.updatedAt ?? ''),
  }));
}

async function commit(
  op: 'approve' | 'reject',
  id: number,
  expectedUpdatedAt: string,
): Promise<TriageCommitResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/approvals/${id}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt }),
    });
    if (res.ok) return 'ok';
    // 409 = stale snapshot; 400 "not pending" means someone else already decided it.
    return res.status === 409 || res.status === 400 ? 'conflict' : 'error';
  } catch {
    return 'error';
  }
}

const api: TriageApi = {
  approve: (id, at) => commit('approve', id, at),
  reject: (id, at) => commit('reject', id, at),
  reload: fetchPending,
};

export default function TriagePage() {
  const t = useTranslations('triage');
  const [initial, setInitial] = useState<TriageItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchPending().then(setInitial, () => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <p role="alert" className="p-6 text-red-600 dark:text-red-400">
        {t('loadFailed')}
      </p>
    );
  }
  if (initial === null) {
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  }
  return <TriageStream initialItems={initial} />;
}

function TriageStream({ initialItems }: { initialItems: TriageItem[] }) {
  const t = useTranslations('triage');
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const stream = useTriageStream({ initialItems, api, graceMs: GRACE_MS });
  const focusRef = useRef<HTMLDivElement>(null);

  const bindings = useMemo<TriageKeyBinding[]>(
    () =>
      shortcuts
        .filter((s) => s.id in ACTION_BY_ID)
        .map((s) => ({
          action: ACTION_BY_ID[s.id],
          key: s.key,
          meta: s.meta,
          ctrl: s.ctrl,
          shift: s.shift,
        })),
    [shortcuts],
  );
  const approveKey = bindings.find((b) => b.action === 'approve')?.key.toUpperCase() ?? '';

  const handlers = useMemo(
    () => ({
      approve: stream.approve,
      reject: stream.reject,
      defer: stream.defer,
      next: stream.next,
      undo: stream.undo,
      cancel: stream.cancel,
      reload: () => void stream.reload(),
    }),
    [stream],
  );
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = resolveTriageKey(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          targetTag: target?.tagName ?? '',
          isContentEditable: target?.isContentEditable ?? false,
        },
        bindings,
      );
      if (!action) return;
      e.preventDefault();
      handlersRef.current[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings]);

  // Keep focus pinned to the current item so a screen reader reads it on change.
  const currentId = stream.current?.id;
  useEffect(() => {
    focusRef.current?.focus();
  }, [currentId]);

  const a = stream.announcement;
  const announceText = a.seq === 0 ? '' : t(`announce.${a.kind}`, { count: a.remaining });

  const press = useCallback(
    (fn: () => void) => () => {
      fn();
      focusRef.current?.focus();
    },
    [],
  );

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('remainingLabel', { count: stream.remaining })}
        </span>
      </header>

      <TriageLiveRegion message={announceText} politeness={a.politeness} seq={a.seq} />

      <div ref={focusRef} tabIndex={-1} className="outline-none space-y-4">
        {stream.current ? (
          <>
            <TriageItemCard item={stream.current} />
            <DecisionTimerPanel item={stream.current} />
          </>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-300">{t('empty')}</p>
        )}

        {stream.conflict && (
          <div
            role="group"
            aria-label={t('conflict.title')}
            className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-300"
          >
            <p className="font-semibold">{t('conflict.title')}</p>
            <p className="mt-1">{t('conflict.body')}</p>
          </div>
        )}

        {stream.confirming && (
          <TriageConfirmStep approveKey={approveKey} onCancel={press(stream.cancel)} />
        )}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t('irreversibleNotice', { seconds: GRACE_MS / 1000 })}
      </p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['approve', stream.approve, stream.conflict],
            ['defer', stream.defer, stream.conflict],
            ['reject', stream.reject, stream.conflict],
            ['next', stream.next, stream.conflict],
            ['undo', stream.undo, false],
            ['reload', () => void stream.reload(), false],
          ] as const
        ).map(([name, fn, disabled]) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            onClick={press(fn)}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50"
          >
            {t(`actions.${name}`)}
          </button>
        ))}
      </div>
    </main>
  );
}
