/**
 * Windows Shell Escape
 *
 * Escapes a single argument so it survives Windows `cmd.exe` re-parsing
 * unchanged when spawned with `shell: true`, using the MSVCRT
 * backslash-doubling + cmd.exe meta-character caret-escaping algorithm
 * documented at https://qntm.org/cmd and implemented by `cross-spawn`. Not
 * responsible for building a full command line or argv array — callers join
 * the escaped tokens themselves.
 */

const META_CHARS_WITH_QUOTE_REGEXP = /([()%!^"<>&|;,])/g;

/**
 * Escape a single argument for safe inclusion in a Windows `cmd.exe`
 * command line invoked with `shell: true`.
 *
 * The result is unconditionally quoted — never gated behind a "does this
 * argument contain a dangerous character" check, since that kind of
 * allowlist is what produces incomplete escaping (CodeQL
 * js/incomplete-sanitization).
 *
 * There are two distinct escaping needs, controlled by
 * `doubleEscapeMetaChars`, discovered empirically via
 * `process-runner-args.cmd-roundtrip.test.ts` (a real `cmd.exe` round-trip,
 * not just a string-content assertion):
 *
 * - Args destined for a called program (`doubleEscapeMetaChars: true`):
 *   `cmd.exe` never needs to recognize these as a single *quoted* token —
 *   the target program's own argv parser (MSVCRT `CommandLineToArgvW`
 *   rules) does the real space-splitting from Step 1's backslash-doubling.
 *   So the wrapping quotes are included in the meta-character caret-escape
 *   pass too, applied twice when the target is a `.cmd`/`.bat` shim: its
 *   body re-expands `%*` into a second command line that `cmd.exe` parses
 *   again, and the first escape layer is what survives that first parse.
 * - The command name itself (`doubleEscapeMetaChars: false`, e.g.
 *   `codexPath`): `cmd.exe`'s own command-boundary detection needs to see a
 *   REAL (non-caret-escaped) pair of quotes to treat an embedded space as
 *   part of the name rather than a word separator — caret-escaping the
 *   quote here breaks that recognition and splits the path at the space.
 *   This path is never re-parsed a second time (unlike args, it is not
 *   subject to `%*` re-expansion), and it is not attacker-controlled (it
 *   comes from `resolveCliPath`, not task/prompt content), so no
 *   meta-character escaping is applied beyond the real quotes themselves —
 *   real quotes already neutralize `&`/`|`/`<`/`>`/`(`/`)` on their own.
 *
 * @param arg - the raw argument value / エスケープ対象の生の引数値
 * @param doubleEscapeMetaChars - true for an argument passed to the
 *   invoked program (needs the double caret-escape described above); false
 *   for the command name itself, which needs real space-protecting quotes
 *   instead / 呼び出し先プログラムへの引数なら true、コマンド名自体（実引用符
 *   によるスペース保護が必要）なら false
 * @returns the escaped, quoted argument, safe to join with spaces into a
 *   `shell: true` command string / スペース区切りで結合しても安全な
 *   エスケープ済み引数
 */
export function escapeWindowsShellArg(arg: string, doubleEscapeMetaChars: boolean): string {
  return escapeWindowsShellArgLayers(arg, doubleEscapeMetaChars ? 2 : 0);
}

/** How many `cmd.exe` parses an argument must survive before reaching the target program. */
export type WindowsShellEscapeLayers = 0 | 1 | 2;

/**
 * Number of caret-escape layers an argument needs for a given spawn target.
 *
 * A `.cmd`/`.bat` shim (npm global bins) re-expands `%*` into a second
 * command line that `cmd.exe` parses again, so its arguments must survive two
 * parses. A native executable (e.g. the standalone `claude.exe` installer,
 * task 970 regression) is parsed by `cmd.exe` exactly once — feeding it the
 * two-layer form leaves one caret layer intact, and the program receives
 * `^--print^` instead of `--print`. A target without an extension (an
 * unresolved bare name such as `codex`) keeps the shim depth: cmd.exe still
 * resolves it through PATHEXT at exec time, where an npm-installed `.cmd`
 * shim is the common outcome, and the two-layer form is the one that stays
 * injection-safe across that shim's `%*` re-parse.
 *
 * @param targetPath - Resolved spawn target (path or bare name). / 起動対象
 * @returns 1 for a target with a non-batch extension (native executable),
 *   otherwise 2. / バッチ以外の拡張子付き(ネイティブ実行体)なら1、それ以外は2
 */
export function windowsShellEscapeLayersFor(targetPath: string): WindowsShellEscapeLayers {
  const ext = /\.([^\\/.\s]+)\s*$/.exec(targetPath)?.[1]?.toLowerCase();
  if (!ext) return 2;
  return ext === 'cmd' || ext === 'bat' ? 2 : 1;
}

/**
 * Escape an argument destined for `targetPath`, choosing the caret-escape
 * depth from the target's kind (see windowsShellEscapeLayersFor). Prefer this
 * over `escapeWindowsShellArg(arg, true)` whenever the target may be a native
 * executable rather than a `.cmd` shim.
 *
 * @param targetPath - Resolved spawn target the argument is passed to. / 引数の渡し先
 * @param arg - Raw argument value. / 生の引数値
 * @returns Escaped, quoted argument. / エスケープ済み引数
 */
export function escapeWindowsShellArgForTarget(targetPath: string, arg: string): string {
  return escapeWindowsShellArgLayers(arg, windowsShellEscapeLayersFor(targetPath));
}

/**
 * Core escaper: MSVCRT backslash rules + unconditional quoting, then
 * `layers` passes of cmd.exe meta-character caret-escaping.
 *
 * @param arg - Raw argument value. / 生の引数値
 * @param layers - 0 for the command name itself (real quotes), 1 for a native
 *   executable's argument, 2 for a `.cmd`/`.bat` shim's argument. / 通過する
 *   cmd.exe パース回数
 * @returns Escaped, quoted argument. / エスケープ済み引数
 */
export function escapeWindowsShellArgLayers(arg: string, layers: WindowsShellEscapeLayers): string {
  // Step 1 (MSVCRT rule): a run of backslashes immediately preceding a `"`
  // doubles in length before the escaped quote; a run of backslashes at the
  // end of the string (i.e. immediately before the closing quote added in
  // Step 2) also doubles. This is what CodeQL flagged as missing.
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');

  // Step 2: unconditionally quote.
  escaped = `"${escaped}"`;

  // Command-name case: keep the quotes real (see the doc comment above).
  // Step 3 (args case only): neutralize cmd.exe meta characters that
  // remain live even inside quotes (`%` env-var expansion, `^` escape char
  // itself, `!` delayed expansion, `&`/`|`/`;`/`,` command separators,
  // `<`/`>` redirection, `(`/`)` grouping) — including the quote character
  // added in Step 2, which turns this from a "really quoted" token (whose
  // caret would be inert) into caret-escaped literal text that each
  // `cmd.exe` parse on the way to the program unwinds, one layer per parse.
  for (let i = 0; i < layers; i += 1) {
    escaped = escaped.replace(META_CHARS_WITH_QUOTE_REGEXP, '^$1');
  }

  return escaped;
}
