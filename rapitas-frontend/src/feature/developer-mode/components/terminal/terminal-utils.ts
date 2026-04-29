/**
 * terminalUtils
 *
 * Pure utility functions and types shared across terminal sub-components.
 * Contains no React dependencies.
 */

/** Represents a single rendered line in the terminal output. */
export type LogLine = {
  id: string;
  type: 'user' | 'agent' | 'system' | 'error' | 'question' | 'tool';
  text: string;
  ts: number;
};

/** Maximum number of lines kept in memory to prevent unbounded growth. */
export const MAX_TERMINAL_LINES = 1000;
/** Maximum rendered terminal characters. Codex/Gemini can emit very large logs. */
export const MAX_TERMINAL_CHARS = 120_000;

/**
 * Classifies a raw log string into a LogLine type based on prefix conventions.
 *
 * @param line - Raw log text / 生のログテキスト
 * @returns The semantic type for rendering / 表示に使うセマンティック型
 */
export function classifyLine(line: string): LogLine['type'] {
  if (line.startsWith('[Tool:') || line.startsWith('[ツール:')) return 'tool';
  if (line.startsWith('[エラー]') || line.startsWith('[Error]') || line.startsWith('[失敗]'))
    return 'error';
  if (
    line.startsWith('[Question]') ||
    line.startsWith('[質問]') ||
    line.includes('waitingForInput')
  )
    return 'question';
  if (line.startsWith('[System') || line.startsWith('[システム')) return 'system';
  return 'agent';
}

/**
 * Maps a LogLine type to a Tailwind text-color class.
 *
 * @param type - LogLine type / ログライン種別
 * @returns Tailwind class string / Tailwindクラス文字列
 */
export function lineColor(type: LogLine['type']): string {
  switch (type) {
    case 'user':
      return 'text-violet-400';
    case 'tool':
      return 'text-cyan-400';
    case 'error':
      return 'text-red-400';
    case 'question':
      return 'text-amber-400';
    case 'system':
      return 'text-zinc-500';
    default:
      return 'text-zinc-300';
  }
}

/**
 * Appends newLines to prev while respecting the MAX_TERMINAL_LINES cap.
 *
 * @param prev - Existing lines / 現在のライン配列
 * @param newLines - Lines to append / 追加するライン配列
 * @returns Capped combined array / 上限を考慮した結合配列
 */
export function appendCapped(prev: LogLine[], newLines: LogLine[]): LogLine[] {
  const combined = [...prev, ...newLines];
  const lineCapped =
    combined.length > MAX_TERMINAL_LINES ? combined.slice(-MAX_TERMINAL_LINES) : combined;

  let remainingChars = MAX_TERMINAL_CHARS;
  const charCapped: LogLine[] = [];
  for (let i = lineCapped.length - 1; i >= 0; i--) {
    const line = lineCapped[i];
    if (remainingChars <= 0) break;
    if (line.text.length <= remainingChars) {
      charCapped.unshift(line);
      remainingChars -= line.text.length;
      continue;
    }
    charCapped.unshift({
      ...line,
      text: line.text.slice(-remainingChars),
    });
    break;
  }

  return charCapped;
}
