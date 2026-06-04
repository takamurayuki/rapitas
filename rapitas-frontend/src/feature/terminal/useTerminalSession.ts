/**
 * useTerminalSession
 *
 * Binds one xterm.js instance to a backend PTY session. Creates the PTY lazily
 * once the container has a real size, pipes input/output, keeps the PTY sized,
 * and (via PowerShell OSC 133 shell integration) detects command completion to
 * fire an optional callback.
 */
'use client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  onTerminalOutput,
  onTerminalExit,
  decodeBase64,
  isTauri,
} from './terminal-ipc';
import { registerTerminal, unregisterTerminal } from './terminal-registry';

interface TerminalSessionOptions {
  /** Working directory for the PTY (used only at creation). */
  cwd?: string;
  /** Fired when a command finishes (OSC 133 D), with exit code + duration. */
  onCommandComplete?: (exitCode: number, durationMs: number) => void;
}

/**
 * @param sessionId - PTY session id (the pane id) / PTYセッションID（=ペインID）
 * @param opts - cwd + command-completion callback / 作業dir + 完了コールバック
 * @returns Ref to attach to the terminal container div / 端末コンテナ用ref
 */
export function useTerminalSession(sessionId: string, opts?: TerminalSessionOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep latest opts without re-running the effect (which would respawn the PTY).
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTauri()) return;

    let disposed = false;
    let created = false;
    // Timestamp of the last command submission (Enter), for duration on finish.
    let commandStartTs: number | null = null;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#1e1e2e', foreground: '#cdd6f4' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    // Expose for external focus (e.g. focusing the leftmost pane on open).
    registerTerminal(sessionId, term);

    // Swallow OSC 133 shell-integration markers; use D (command done) to report
    // completion. Markers from the very first prompt (no command run yet) are
    // ignored because commandStartTs is still null.
    term.parser.registerOscHandler(133, (data) => {
      if (data.startsWith('D')) {
        const parts = data.split(';');
        const parsed = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        const exitCode = Number.isNaN(parsed) ? 0 : parsed;
        if (commandStartTs != null) {
          const durationMs = Date.now() - commandStartTs;
          commandStartTs = null;
          optsRef.current?.onCommandComplete?.(exitCode, durationMs);
        }
      }
      return true;
    });

    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let observer: ResizeObserver | null = null;

    const ensureSizedAndCreated = async () => {
      if (disposed || !containerRef.current) return;
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols <= 0 || term.rows <= 0) return;
      if (!created) {
        created = true;
        try {
          await createTerminal({
            id: sessionId,
            cols: term.cols,
            rows: term.rows,
            cwd: optsRef.current?.cwd,
          });
        } catch {
          // PTY already exists (e.g. dev StrictMode remount) — reattach only.
        }
        if (disposed) return;
        term.onData((data) => {
          // Enter submits a command; record start for duration-on-finish.
          if (data.includes('\r')) commandStartTs = Date.now();
          writeTerminal(sessionId, data).catch(() => {});
        });
      } else {
        resizeTerminal(sessionId, term.cols, term.rows).catch(() => {});
      }
    };

    (async () => {
      unlistenOutput = await onTerminalOutput((event) => {
        if (event.id === sessionId) term.write(decodeBase64(event.data));
      });
      unlistenExit = await onTerminalExit((event) => {
        if (event.id === sessionId) term.writeln('\r\n\x1b[90m[process exited]\x1b[0m');
      });
      if (disposed) return;
      observer = new ResizeObserver(() => {
        ensureSizedAndCreated();
      });
      observer.observe(container);
      ensureSizedAndCreated();
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      unregisterTerminal(sessionId);
      term.dispose();
    };
  }, [sessionId]);

  return containerRef;
}
