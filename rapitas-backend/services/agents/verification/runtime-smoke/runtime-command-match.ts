/**
 * runtime-smoke/runtime-command-match
 *
 * Splits a process command line into arguments and compares two of them
 * argument by argument. Pure. It is the identity test behind every stop
 * decision, so it errs toward "no match": an unterminated quote or any
 * difference yields no match, never a partial one.
 */

/**
 * Normalize a path-like string for comparison: forward slashes, no trailing
 * slash, case-folded on win32 (NTFS is case-insensitive).
 *
 * @param value - Path or argument / パスまたは引数
 * @returns Comparable form / 比較用の形
 */
export function normalizeForMatch(value: string): string {
  const slashed = value.replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * Split a command line into arguments, honouring quotes. Windows keeps
 * backslashes literal (they are path separators); POSIX treats them as escapes.
 *
 * @param command - Raw command line / コマンドライン
 * @returns Arguments, or null when a quote is never closed or the line is empty / 引数配列
 */
export function tokenizeCommandLine(command: string): string[] | null {
  const windows = process.platform === 'win32';
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (!windows && ch === '\\' && quote === '"' && i + 1 < command.length)
        current += command[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || (!windows && ch === "'")) {
      quote = ch;
      started = true;
    } else if (!windows && ch === '\\' && i + 1 < command.length) {
      current += command[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) return null;
  if (started) args.push(current);
  return args.length > 0 ? args : null;
}

/**
 * Whether two argument lists are identical argument by argument (paths compared
 * after normalization). Substrings never match.
 *
 * @param recorded - Arguments recorded at launch / 起動時に記録した引数
 * @param current - Arguments of the live process / 現在の引数
 * @returns True only for a full match / 完全一致ならtrue
 */
export function sameArgv(recorded: string[] | null, current: string[] | null): boolean {
  if (!recorded || !current || recorded.length === 0 || recorded.length !== current.length) {
    return false;
  }
  return recorded.every((arg, i) => normalizeForMatch(arg) === normalizeForMatch(current[i]));
}
