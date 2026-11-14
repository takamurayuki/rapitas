'use client';
/**
 * SettingsModal
 *
 * The app's settings, shown as one modal over the current page (section list
 * on the left, the chosen section on the right) instead of the old
 * /settings/* pages. Mounted once in the root layout; opened through
 * useSettingsModalStore / openSettings.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';
import { useOccludesWebview } from '@/stores/webview-occlusion-store';
import { useSettingsModalStore } from './settings-modal-store';
import { SETTINGS_SECTIONS } from './settings-sections';
import { SettingsModalNav } from './SettingsModalNav';

/** Renders the settings modal while it is open. */
export function SettingsModal() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const isOpen = useSettingsModalStore((s) => s.isOpen);
  const section = useSettingsModalStore((s) => s.section);
  const close = useSettingsModalStore((s) => s.close);
  const setSection = useSettingsModalStore((s) => s.setSection);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, isOpen);
  // The in-app browser's desktop webview is an OS surface painted above all
  // HTML, so it would cover this modal on /browser; while open, hide it.
  useOccludesWebview(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // NOTE: A section's own dialog (e.g. a confirm) handles Esc first and
      // stops it; only an unhandled Esc closes the whole settings modal.
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll along with the modal's content pane.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, close]);

  // A new section starts at its top, not at the previous section's scroll offset.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [section]);

  if (!isOpen) return null;

  const { Component, labelKey } = SETTINGS_SECTIONS[section];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 md:p-6"
      onClick={close}
      role="presentation"
      data-testid="settings-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl focus:outline-none md:h-[min(85vh,800px)] md:max-w-5xl md:flex-row md:rounded-2xl md:border md:border-zinc-200 dark:bg-zinc-900 dark:md:border-zinc-700"
      >
        <div className="flex shrink-0 flex-col md:w-56">
          <div className="flex items-center justify-between px-4 pb-1 pt-4 md:px-5">
            <h2
              id="settings-modal-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {t('layout.modalTitle')}
            </h2>
            {/* Below md the close button lives here; from md it sits on the content header. */}
            <button
              type="button"
              onClick={close}
              aria-label={tCommon('close')}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <SettingsModalNav active={section} onSelect={setSection} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:border-l md:border-zinc-200 dark:md:border-zinc-800">
          <div className="hidden shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-3.5 md:flex dark:border-zinc-800">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t(labelKey)}</h3>
            <button
              type="button"
              onClick={close}
              aria-label={tCommon('close')}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <Component />
          </div>
        </div>
      </div>
    </div>
  );
}
