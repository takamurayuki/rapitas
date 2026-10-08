/**
 * scaffold-project-writer
 *
 * Writes the generated project skeleton (manifests, tsconfig, lint/test config,
 * entry stubs) into a freshly created project. NOT responsible for the docs
 * (scaffold-docs-writer), the agent guide, git init, or installing dependencies.
 *
 * Every path here comes from a model's JSON output, so it is VALIDATED rather
 * than trusted: a single `..` or absolute path would let a generation write
 * anywhere the backend can reach.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../../config/logger';

const logger = createLogger('routes:scaffold-project-writer');

/** One generated file, as the model returns it. */
export interface ScaffoldFile {
  path: string;
  content: string;
}

/** Caps chosen so a runaway generation cannot fill the disk. */
export const MAX_SCAFFOLD_FILES = 60;
export const MAX_SCAFFOLD_FILE_BYTES = 64 * 1024;
export const MAX_SCAFFOLD_TOTAL_BYTES = 512 * 1024;

/**
 * Paths the scaffold must never supply: they are produced by the other writers,
 * and letting a skeleton overwrite them would silently discard the specs.
 */
const RESERVED_PREFIXES = ['docs/', '.git/', '.claude/', '.worktrees/', 'node_modules/'];
const RESERVED_FILES = ['AGENTS.md', 'GEMINI.md', '.cursorrules'];

/** Why a file was refused, or null when it is acceptable. */
export function rejectScaffoldPath(rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.trim().length === 0) return 'empty path';
  if (rel.length > 200) return 'path too long';
  // Normalize separators first so the checks below cannot be bypassed with `\`.
  const unix = rel.replace(/\\/g, '/');
  if (unix.startsWith('/')) return 'absolute path';
  if (/^[a-zA-Z]:/.test(unix)) return 'drive-qualified path';
  if (unix.split('/').some((seg) => seg === '..')) return 'parent traversal';
  if (unix.split('/').some((seg) => seg === '.' || seg === '')) return 'empty path segment';
  if (/[\0<>:"|?*]/.test(unix)) return 'illegal character';
  const lower = unix.toLowerCase();
  if (RESERVED_PREFIXES.some((p) => lower.startsWith(p))) return 'reserved directory';
  if (RESERVED_FILES.some((f) => lower === f.toLowerCase())) return 'reserved file';
  return null;
}

/** Outcome of a skeleton write. */
export interface SkeletonResult {
  written: string[];
  /** `path: reason` for each refused entry, so a bad generation is visible. */
  rejected: Record<string, string>;
}

/**
 * Write the skeleton under `projectPath`.
 *
 * Refused entries are reported rather than thrown on: a skeleton with one bad
 * path is still worth landing, and the caller logs what was dropped.
 *
 * @param projectPath - Absolute project root / プロジェクトの絶対パス
 * @param files - Generated files / 生成されたファイル
 * @returns Written relative paths and the rejections / 書き込んだ相対パスと却下理由
 */
export function writeProjectSkeleton(
  projectPath: string,
  files: readonly ScaffoldFile[] | undefined,
): SkeletonResult {
  const result: SkeletonResult = { written: [], rejected: {} };
  if (!files?.length) return result;

  const seen = new Set<string>();
  let totalBytes = 0;

  for (const file of files.slice(0, MAX_SCAFFOLD_FILES)) {
    const reason = rejectScaffoldPath(file?.path);
    if (reason) {
      result.rejected[String(file?.path ?? '<missing>')] = reason;
      continue;
    }
    const rel = file.path.replace(/\\/g, '/');
    if (typeof file.content !== 'string') {
      result.rejected[rel] = 'content is not a string';
      continue;
    }
    if (seen.has(rel)) {
      result.rejected[rel] = 'duplicate path';
      continue;
    }

    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > MAX_SCAFFOLD_FILE_BYTES) {
      result.rejected[rel] = `file exceeds ${MAX_SCAFFOLD_FILE_BYTES} bytes`;
      continue;
    }
    if (totalBytes + bytes > MAX_SCAFFOLD_TOTAL_BYTES) {
      result.rejected[rel] = 'total size limit reached';
      continue;
    }

    // Belt and braces: even with the checks above, never write outside the root.
    const abs = path.resolve(projectPath, rel);
    if (abs !== projectPath && !abs.startsWith(projectPath + path.sep)) {
      result.rejected[rel] = 'resolves outside the project';
      continue;
    }

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content, 'utf8');
    seen.add(rel);
    totalBytes += bytes;
    result.written.push(rel);
  }

  if (files.length > MAX_SCAFFOLD_FILES) {
    result.rejected['<overflow>'] = `only the first ${MAX_SCAFFOLD_FILES} files were written`;
  }
  // Logged here rather than at the call site: a refused path means the
  // generation produced something invalid, and that must not vanish silently.
  if (Object.keys(result.rejected).length > 0) {
    logger.warn({ projectPath, rejected: result.rejected }, 'Skeleton entries refused');
  }
  return result;
}
