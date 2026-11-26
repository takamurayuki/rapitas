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
 * 引用符を解いて引数へ分解する。Windows は引用符直前のバックスラッシュの
 * 偶奇を扱い、POSIX は単引用符と二重引用符のエスケープを区別する。
 *
 * @param command - Raw command line / コマンドライン
 * @param platform - 分解するコマンドの OS
 * @returns Arguments, or null when a quote is never closed or the line is empty / 引数配列
 */
export function tokenizeCommandLine(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] | null {
  const windows = platform === 'win32';
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (windows && ch === '\\') {
      let end = i;
      while (command[end] === '\\') end++;
      const count = end - i;
      if (command[end] === '"') {
        current += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) {
          current += '"';
          i = end;
        } else {
          i = end - 1;
        }
      } else {
        current += '\\'.repeat(count);
        i = end - 1;
      }
      started = true;
      continue;
    }
    if (!windows && ch === '\\' && quote !== "'") {
      if (i + 1 === command.length) return null;
      const next = command[i + 1];
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) {
        current += ch;
      } else {
        i++;
        if (next !== '\n') current += next;
      }
      started = true;
      continue;
    }
    if (quote) {
      if (windows && ch === '"' && command[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || (!windows && ch === "'")) {
      quote = ch;
      started = true;
    } else if ((windows ? /[ \t]/ : /\s/).test(ch)) {
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
  const isPath = (arg: string) =>
    /^(?:[a-z]:[/\\]|\\\\|\.{1,2}[/\\])/i.test(arg) ||
    (process.platform !== 'win32' && arg.startsWith('/'));
  return recorded.every((arg, i) => {
    if (arg === current[i]) return true;
    // 通常引数の大小文字や末尾区切りは意味を持つため、パスとして推測しない。
    return (
      isPath(arg) && isPath(current[i]) && normalizeForMatch(arg) === normalizeForMatch(current[i])
    );
  });
}
