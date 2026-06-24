/**
 * parse-files-arg
 *
 * Shared utility for parsing the --files CLI argument used by CI gate scripts.
 * Returns a three-valued result that distinguishes "flag absent" from "flag present but empty"
 * so that callers can apply safe-fallback logic without conflating the two cases.
 */

/**
 * Parses the `--files` CLI argument from an argv array.
 *
 * Three-valued semantics:
 *   - `null`      : flag is absent — caller should run all tests (safe fallback)
 *   - `[]`        : flag is present but value is empty (e.g. `--files=`) — caller should run all tests
 *   - `string[]`  : one or more file paths — caller may apply trigger-based filtering
 *
 * Accepted forms:
 *   --files=a.ts,b.ts    (comma-separated)
 *   --files a.ts b.ts    (space-separated positional args until the next flag)
 *
 * @param argv - `process.argv` or equivalent array / コマンドライン引数配列
 * @returns Parsed file paths, `[]` for an empty flag, or `null` when the flag is absent
 */
export function parseFilesArg(argv: string[]): string[] | null {
  const idx = argv.findIndex((a) => a === '--files' || a.startsWith('--files='));
  if (idx === -1) return null;

  const arg = argv[idx];
  if (arg.startsWith('--files=')) {
    const val = arg.slice('--files='.length);
    return val
      ? val
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : [];
  }

  const files: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break;
    files.push(argv[i]);
  }
  return files;
}
