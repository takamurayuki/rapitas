/**
 * verifier-format
 *
 * Prettier formatting verification check (CI-parity `prettier --check`).
 * Not responsible for lint/typecheck/test checks. Extracted from
 * automated-verifier.ts (file-size split).
 */
import { extname, join, relative } from 'path';
import { MAX_DETAIL_CHARS, resolveBin, runCmd } from './verifier-exec';
import type { VerificationCheck } from './verification-types';

/** Extensions the CI prettier steps check (backend *.ts / frontend src globs). */
const FORMAT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.md']);

/**
 * Prettier-checks a project's changed files — CI's "Check formatting" steps
 * run `prettier --check`, so an unformatted file passes the local eslint gate
 * yet still bounces the PR at CI (a whole ci_repair round for whitespace).
 * Skips silently when the project has no prettier binary (not every repo
 * formats with prettier); prettier itself respects .prettierignore.
 */
export async function formatProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  const files = relFiles.filter((f) => FORMAT_EXTENSIONS.has(extname(f).toLowerCase()));
  if (files.length === 0) return null;
  const bin = resolveBin(projectRoot, workdir, 'prettier');
  if (!bin) return null;
  const args = files
    .map((f) => `"${relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')}"`)
    .join(' ');
  const res = await runCmd(`"${bin}" --check --ignore-unknown ${args}`, projectRoot);
  const ok = res.code === 0;
  return {
    name: 'format',
    ran: true,
    ok,
    errorCount: ok ? 0 : Math.max(1, (res.stderr.match(/^\[warn\]/gm) ?? []).length),
    details: ok
      ? 'prettier: all changed files formatted'
      : `prettier --check に失敗（CI の formatting チェックで落ちます）。\`prettier --write\` で整形してください:\n${(res.stderr || res.stdout).slice(0, MAX_DETAIL_CHARS)}`,
  };
}
