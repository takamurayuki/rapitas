/**
 * TerminalView
 *
 * Renders a single terminal pane: the xterm container plus a close affordance.
 * One TerminalView == one PTY session. Surfaces a toast when a long-running
 * command finishes while the user isn't looking at the terminal.
 */
'use client';
import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useTerminalSession } from './useTerminalSession';
import { useTerminalStore } from './terminal-store';

/** Only commands longer than this notify on completion. */
const NOTIFY_THRESHOLD_MS = 8000;

interface TerminalViewProps {
  sessionId: string;
  /** Working directory for this pane's shell (inherited from its tab). */
  cwd?: string;
  /** Command to pre-fill at the prompt once the PTY is ready (not auto-run). */
  initialCommand?: string;
  isActive: boolean;
  /** Whether a close button shows (hidden when the pane is the tab's only one). */
  closable: boolean;
  onFocus: () => void;
  onClose: () => void;
}

/**
 * @param props - sessionId, cwd, active/close state / セッションID・作業dir・状態
 */
export default function TerminalView({
  sessionId,
  cwd,
  initialCommand,
  isActive,
  closable,
  onFocus,
  onClose,
}: TerminalViewProps) {
  const { showToast } = useToast();
  const t = useTranslations('terminal');

  const onCommandComplete = useCallback(
    (exitCode: number, durationMs: number) => {
      if (durationMs < NOTIFY_THRESHOLD_MS) return;
      // Skip when the user is actively watching this terminal.
      const watching = document.hasFocus() && useTerminalStore.getState().isOpen;
      if (watching) return;
      const seconds = Math.round(durationMs / 1000);
      showToast(
        t('commandCompleteToast', { exitCode, seconds }),
        exitCode === 0 ? 'success' : 'error',
      );
    },
    [showToast, t],
  );

  const containerRef = useTerminalSession(sessionId, { cwd, initialCommand, onCommandComplete });

  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border ${
        isActive ? 'border-indigo-500/60' : 'border-transparent'
      }`}
      onMouseDown={onFocus}
    >
      {closable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-1 top-1 z-10 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-700 hover:text-zinc-100 group-hover:opacity-100"
          aria-label={t('closePane')}
          title={t('closePane')}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <div ref={containerRef} className="min-h-0 min-w-0 flex-1 px-1 py-0.5" />
    </div>
  );
}
