/**
 * useAutoRunTaskSelection
 *
 * Which of the theme's running tasks the auto-run strip shows, remembered per
 * theme in localStorage. Not responsible for fetching task state.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ActiveTask } from '@/hooks/workflow/useThemeAutoRun';

const KEY_PREFIX = 'rapitas:autoRun:selectedTask:';

function read(themeId: number | null | undefined): number | null {
  if (typeof window === 'undefined' || themeId == null) return null;
  try {
    const n = Number(window.localStorage.getItem(KEY_PREFIX + themeId));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null; // storage blocked: fall back to the head
  }
}

/**
 * Resolve the shown task id.
 *
 * @param themeId - Theme whose choice is remembered / テーマID
 * @param activeTasks - Running tasks, head first / 動作中のタスク
 * @returns The shown id, the head id and a setter that also persists / 表示中のID・先頭ID・選択関数
 */
export function useAutoRunTaskSelection(
  themeId: number | null | undefined,
  activeTasks: ActiveTask[] | undefined,
) {
  const [chosen, setChosen] = useState<{
    themeId: number | null | undefined;
    id: number | null;
  } | null>(null);
  // 保存領域は初回描画後とテーマ変更後だけ読む。消失時の復帰は下の導出で行う。
  useEffect(() => {
    setChosen({ themeId, id: read(themeId) });
  }, [themeId]);
  // Derived, not reset in an effect: a saved id missing from the list means the
  // head, and the choice comes back if that task reappears.
  const saved = chosen?.themeId === themeId ? (chosen?.id ?? null) : null;
  const headId = activeTasks?.[0]?.id ?? null;
  const selectedId = saved !== null && activeTasks?.some((a) => a.id === saved) ? saved : headId;

  const select = useCallback(
    (id: number) => {
      if (themeId != null) {
        try {
          window.localStorage.setItem(KEY_PREFIX + themeId, String(id));
        } catch {
          // 保存できない場合も、計画どおり先頭へ戻す。
          setChosen({ themeId, id: null });
          return;
        }
      }
      setChosen({ themeId, id });
    },
    [themeId],
  );

  return { selectedId, headId, select };
}
