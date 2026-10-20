'use client';
/**
 * TaskConsult
 *
 * Talking to ラピ about the task you are looking at.
 *
 * This is the AI assistant that used to be a card on the task detail page,
 * moved rather than rebuilt: the same `CopilotChatPanel`, against the same
 * `/copilot` endpoints, with the same history and the same next-action
 * recommendations. It was already written to be hosted elsewhere — it takes
 * an `embedded` prop — and there is only ever one of it now, because the
 * page's copy is gone.
 *
 * The page cost a card's worth of height on every task to offer a
 * conversation most of them never had. ラピ is the thing in this app you
 * talk to, so the conversation lives with her and the page got shorter.
 *
 * Not responsible for the chat itself — see `components/copilot`.
 */
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
import { CopilotChatPanel } from '@/components/copilot';
import type { Task } from '@/types';

const logger = createLogger('rapi-consult');

/**
 * The task the user is looking at, from the address bar.
 *
 * ラピ is mounted in the app shell and has no props from the page, so the URL
 * is what tells her which task is open. `TaskDetailClient` reads it the same
 * way for the same reason.
 *
 * Two shapes, because a task is opened two ways: `/tasks/42` is the full
 * page, and `/?panel=42` is the slide panel over the list, which
 * `openTaskPanel` writes so a back-navigation can restore it. Reading only
 * the path left her unable to name the task in the one mode the list uses
 * most.
 *
 * @param pathname - The current path / 現在のパス
 * @param panelParam - The `panel` query parameter, if any / `panel` クエリ
 * @returns The task id, or null when no task is open / タスクID（開いていなければ null）
 */
export function taskIdFromLocation(
  pathname: string | null,
  panelParam: string | null,
): number | null {
  const onPage = pathname?.match(/\/tasks\/(\d+)/);
  if (onPage) return Number(onPage[1]);
  if (panelParam && /^\d+$/.test(panelParam)) return Number(panelParam);
  return null;
}

export function TaskConsult() {
  const t = useTranslations('rapiAvatar.consult');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const taskId = taskIdFromLocation(pathname, searchParams?.get('panel') ?? null);
  const [task, setTask] = useState<Task | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (taskId === null) {
      setTask(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        const data = await apiFetch<Task>(`/tasks/${taskId}`);
        if (!cancelled) setTask(data);
      } catch (err) {
        logger.warn({ err, taskId }, 'could not load the task to talk about');
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // She can only talk about a task you have open. Saying so beats an empty
  // chat that silently has no subject.
  if (taskId === null) {
    return (
      <section className="space-y-2 p-2">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('noTask')}</p>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="space-y-2 p-2">
        <p className="text-[11px] text-red-600 dark:text-red-400">{t('loadFailed')}</p>
      </section>
    );
  }

  if (!task) {
    return (
      <section className="space-y-2 p-2">
        <p className="text-[11px] text-zinc-400">{t('loading')}</p>
      </section>
    );
  }

  // The same rule-based context the page used to build. Derived entirely from
  // the task, which is why it can be rebuilt here rather than plumbed.
  const subtasks = task.subtasks ?? [];
  const nextActionContext = {
    status: task.status,
    subtaskTotal: subtasks.length,
    subtaskDone: subtasks.filter((s) => s.status === 'done').length,
    complexityScore: task.complexityScore ?? null,
    estimatedHours: task.estimatedHours ?? null,
    canRunAgent: !!(task.theme?.isDevelopment && task.theme?.workingDirectory),
  };

  return (
    // No title line: the task is open on screen beside her, with its name in
    // the page header and the panel header, and a third copy of it inside a
    // 544px bubble spent a row saying what the user is already looking at.
    <section className="p-2">
      <CopilotChatPanel
        embedded
        compact
        taskId={task.id}
        taskTitle={task.title}
        taskStatus={task.status}
        taskDescription={task.description}
        nextActionContext={nextActionContext}
      />
    </section>
  );
}
