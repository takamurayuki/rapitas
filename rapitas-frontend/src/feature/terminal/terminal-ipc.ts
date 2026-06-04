/**
 * terminal-ipc
 *
 * Thin wrappers over the Rust `terminal_*` commands and `terminal://*` events.
 * All calls are no-ops outside Tauri (the integrated terminal is desktop-only).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '@/utils/tauri';
import type { TerminalOutputEvent, TerminalExitEvent } from './terminal.types';

export { isTauri };

/**
 * Spawn a backend PTY for the given session id.
 *
 * @param opts - id (session/pane id), initial cols/rows, optional shell/cwd / セッションID・初期サイズ・任意のシェル/作業ディレクトリ
 * @throws When invoked outside Tauri or the id already exists / Tauri外、またはID重複時
 */
export async function createTerminal(opts: {
  id: string;
  cols: number;
  rows: number;
  shell?: string;
  cwd?: string;
}): Promise<void> {
  await invoke('terminal_create', opts);
}

/** Send keystrokes (UTF-8) to a PTY. / キー入力をPTYへ送る */
export async function writeTerminal(id: string, data: string): Promise<void> {
  await invoke('terminal_write', { id, data });
}

/** Resize a PTY to cols × rows. / PTYをリサイズ */
export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  await invoke('terminal_resize', { id, cols, rows });
}

/** Kill a PTY and drop its session. / PTYを終了 */
export async function closeTerminal(id: string): Promise<void> {
  await invoke('terminal_close', { id });
}

/** Subscribe to PTY output. Returns an unlisten fn. / 出力購読 */
export function onTerminalOutput(
  handler: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>('terminal-output', (e) => handler(e.payload));
}

/** Subscribe to PTY exit. Returns an unlisten fn. / 終了購読 */
export function onTerminalExit(handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>('terminal-exit', (e) => handler(e.payload));
}

/**
 * Decode base64 PTY output to bytes. xterm.js consumes a Uint8Array directly
 * and runs its own incremental UTF-8 decoder, so multibyte chars split across
 * chunks render correctly.
 *
 * @param b64 - Base64 string from the output event / 出力イベントのBase64
 * @returns Raw bytes / 生バイト列
 */
export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
