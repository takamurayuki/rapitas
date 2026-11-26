'use client';

/**
 * useGoalReflection
 *
 * State of the weekly reflection modal: the goals in progress, this week's
 * saved rating and note for each (so the same week can be corrected), and
 * saving. Not responsible for rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { goalReflectionApi, type ReflectionGoal } from './goal-reflection-api';
import { currentWeekStart, noteLength, REFLECTION_NOTE_MAX } from './goal-reflection-week';

/** One goal's editable row. */
export interface ReflectionRowState {
  goal: ReflectionGoal;
  rating: number | null;
  note: string;
  /** True once this week's record exists on the server. */
  saved: boolean;
  /** True when the row differs from what was loaded or last saved. */
  dirty: boolean;
}

export type ReflectionStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'savedAll' | 'error';

/**
 * Load and edit this week's reflections while the modal is open.
 *
 * @param open - Whether the modal is shown; loading happens on each open / 表示中か
 * @returns Rows, status and actions / 行・状態・操作
 */
export function useGoalReflection(open: boolean) {
  const [rows, setRows] = useState<ReflectionRowState[]>([]);
  const [status, setStatus] = useState<ReflectionStatus>('idle');
  const [failed, setFailed] = useState<'load' | 'save' | null>(null);
  const generation = useRef(0);
  const savingGeneration = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    generation.current++;
    let cancelled = false;
    setStatus('loading');
    setFailed(null);
    (async () => {
      try {
        const goals = await goalReflectionApi.openGoals();
        const week = currentWeekStart(new Date());
        const lists = await Promise.all(goals.map((g) => goalReflectionApi.list(g.id)));
        // A response for a closed or reopened modal must not overwrite newer state.
        if (cancelled) return;
        setRows(
          goals.map((goal, i) => {
            const mine = lists[i].find((item) => item.weekStart === week);
            return {
              goal,
              rating: mine?.rating ?? null,
              note: mine?.note ?? '',
              saved: Boolean(mine),
              dirty: false,
            };
          }),
        );
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setFailed('load');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [open]);

  const update = useCallback(
    (goalId: number, patch: Partial<Pick<ReflectionRowState, 'rating' | 'note'>>) => {
      setRows((prev) =>
        prev.map((r) => (r.goal.id === goalId ? { ...r, ...patch, dirty: true } : r)),
      );
      setStatus((s) => (s === 'savedAll' ? 'ready' : s));
    },
    [],
  );

  const setRating = useCallback(
    (goalId: number, rating: number) => update(goalId, { rating }),
    [update],
  );
  const setNote = useCallback((goalId: number, note: string) => update(goalId, { note }), [update]);

  /** A row can be saved once a rating is chosen, the note fits, and something changed. */
  const savable = rows.filter(
    (r) => r.dirty && r.rating !== null && noteLength(r.note) <= REFLECTION_NOTE_MAX,
  );

  const save = useCallback(async () => {
    if (!open || savable.length === 0 || status === 'loading') return;
    const currentGeneration = generation.current;
    if (savingGeneration.current === currentGeneration) return;
    savingGeneration.current = currentGeneration;
    setStatus('saving');
    setFailed(null);
    const results = await Promise.allSettled(
      savable.map((r) => goalReflectionApi.save(r.goal.id, r.rating as number, r.note)),
    );
    // 閉じる前の保存応答は、再表示後の編集や保存状態に反映しない。
    if (generation.current !== currentGeneration) return;
    savingGeneration.current = null;
    const savedRows = new Map(
      savable.filter((_, i) => results[i].status === 'fulfilled').map((r) => [r.goal.id, r]),
    );
    // 送信後の編集は未保存として残し、成功した送信内容との一致だけを確定する。
    setRows((prev) =>
      prev.map((r) => {
        const sent = savedRows.get(r.goal.id);
        return sent
          ? { ...r, saved: true, dirty: r.rating !== sent.rating || r.note !== sent.note }
          : r;
      }),
    );
    if (savedRows.size === savable.length) {
      setStatus('savedAll');
    } else {
      setFailed('save');
      setStatus('error');
    }
  }, [open, savable, status]);

  // 送信対象外を含め、未保存の編集が残る場合は全件保存済みと表示しない。
  const visibleStatus = status === 'savedAll' && rows.some((r) => r.dirty) ? 'ready' : status;
  return {
    rows,
    status: visibleStatus,
    failed,
    setRating,
    setNote,
    save,
    canSave: savable.length > 0,
  };
}
