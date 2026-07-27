'use client';
/**
 * PreviewSettingsModal
 *
 * Lets the user edit a task's theme's preview settings without leaving the
 * task detail page — Save persists to the theme. Starting the preview stays
 * on the main panel's own Start button (which reads the same `headlessMode`
 * this modal's display-mode toggle sets), so there's no duplicate Start
 * control; Stop is offered here too since a test session may already be
 * running while settings are being tweaked. "Normal display" launches a
 * real, visible browser window instead of the default embedded/headless
 * view, for visually confirming the app actually renders correctly.
 */
import { useTranslations } from 'next-intl';
import { Square, Save } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import { Spinner } from '@/components/ui/spinner';
import { PillButton } from '@/components/ui/pill-button';
import { RuntimeConfigEditor } from '@/components/runtime-config/RuntimeConfigEditor';
import type { PreviewState, RuntimeConfigEditorState } from './useTaskPreview';

export interface PreviewSettingsModalProps {
  open: boolean;
  onClose: () => void;
  state: PreviewState;
  configEditor: RuntimeConfigEditorState | null;
  headlessMode: boolean;
  onHeadlessModeChange: (headless: boolean) => void;
  onConfigValueChange: (value: string) => void;
  onSave: () => void;
  onStop: () => void;
}

/**
 * @param props - See {@link PreviewSettingsModalProps}.
 */
export function PreviewSettingsModal({
  open,
  onClose,
  state,
  configEditor,
  headlessMode,
  onHeadlessModeChange,
  onConfigValueChange,
  onSave,
  onStop,
}: PreviewSettingsModalProps) {
  const t = useTranslations('task.preview');
  const isRunning = state.phase === 'active' || state.phase === 'starting';

  const footer = (
    <>
      {isRunning && (
        <PillButton icon={Square} color="zinc" onClick={onStop}>
          {t('stop')}
        </PillButton>
      )}
      {/* Same look as ThemeForm's own save button (theme-form.tsx) — same action, same glyph, same style. */}
      <button
        type="button"
        onClick={onSave}
        disabled={configEditor?.saving}
        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm text-white transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Save className="w-3.5 h-3.5" />
        {configEditor?.saving ? t('starting') : t('save')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settingsModalTitle')}
      maxWidthClass="max-w-xl"
      footer={configEditor?.hasTheme ? footer : undefined}
    >
      {!configEditor ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : !configEditor.hasTheme ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('configureRuntimeNoTheme')}</p>
      ) : (
        <div className="space-y-4">
          <RuntimeConfigEditor value={configEditor.value} onChange={onConfigValueChange} />

          {configEditor.saveError && (
            <p className="text-xs text-red-600 dark:text-red-400">{configEditor.saveError}</p>
          )}

          <div>
            <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{t('displayMode')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={headlessMode}
                onClick={() => onHeadlessModeChange(true)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  headlessMode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
                }`}
              >
                {t('displayModeHeadless')}
              </button>
              <button
                type="button"
                aria-pressed={!headlessMode}
                onClick={() => onHeadlessModeChange(false)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  !headlessMode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
                }`}
              >
                {t('displayModeNormal')}
              </button>
            </div>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('testHint')}</p>

          {state.phase === 'starting' && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Spinner size="sm" />
              {t('startingHint')}
            </div>
          )}
          {state.phase === 'active' && (
            <p className="text-xs text-green-700 dark:text-green-400">
              {t('liveBadge')} — {state.url}
            </p>
          )}
          {state.phase === 'stopping' && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Spinner size="sm" />
              {t('stoppingHint')}
            </div>
          )}
          {state.phase === 'error' && (
            <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default PreviewSettingsModal;
