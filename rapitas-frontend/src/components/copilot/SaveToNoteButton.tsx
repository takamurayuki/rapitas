'use client';

/**
 * SaveToNoteButton
 *
 * The small "ノートに保存" action under one of ラピ's text replies in the
 * copilot panel. Saves once, then shows "保存済み" for as long as the bubble
 * is on screen; it does not ask the server whether a note already exists.
 * Not responsible for building or writing the note — see `copilot-note.ts`.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Loader2, NotebookPen } from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useNoteStore } from '@/stores/note-store';
import { buildCopilotNote, saveCopilotNote } from './copilot-note';

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Saves ラピ's reply (with the question before it) as a note.
 *
 * @param question - the user's words before the reply / 直前のユーザーの発言
 * @param answer - ラピ's reply / ラピの返答
 * @param taskId - the panel's task; the note is linked to it / パネルのタスク（紐付け先）
 */
export function SaveToNoteButton({
  question,
  answer,
  taskId,
}: {
  question: string | null;
  answer: string;
  taskId?: number;
}) {
  const t = useTranslations('copilot.saveToNote');
  const { showToast } = useToast();
  const router = useRouter();
  const [state, setState] = useState<SaveState>('idle');

  // The notes page shows the store's current note, so select it before going there.
  const openNote = (noteId: string) => {
    useNoteStore.getState().setCurrentNote(noteId);
    router.push('/notes');
  };

  const save = async () => {
    if (state !== 'idle') return;
    setState('saving');
    try {
      const result = await saveCopilotNote(buildCopilotNote(question, answer), taskId ?? null);
      setState('saved');
      showToast(
        result.linked === false ? t('savedLinkFailed') : t('savedToast'),
        result.linked === false ? 'warning' : 'success',
        { action: { label: t('open'), onClick: () => openNote(result.noteId) } },
      );
    } catch {
      // Back to idle so the user can try again; nothing was saved.
      setState('idle');
      showToast(t('failed'), 'error');
    }
  };

  const saved = state === 'saved';
  return (
    <button
      type="button"
      onClick={save}
      disabled={state !== 'idle'}
      aria-label={saved ? t('saved') : t('save')}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${saved ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'}`}
    >
      {state === 'saving' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <NotebookPen className="h-3 w-3" />
      )}
      {saved ? t('saved') : state === 'saving' ? t('saving') : t('save')}
    </button>
  );
}
