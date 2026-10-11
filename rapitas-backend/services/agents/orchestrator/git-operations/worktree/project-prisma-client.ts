/**
 * GitOperations — Prisma client generation for non-rapitas project worktrees
 *
 * Generates a generated project's Prisma client once per schema change, at the
 * PROJECT ROOT, so every worktree linked into that root resolves it.
 *
 * Why this exists. rapitas generates its own client from dev.js on startup; a
 * generated project has no equivalent, and the agent cannot do it either: a
 * worktree's `node_modules` is a symlink to the project root's tree, so
 * `hasLinkedNodeModules` is true there and primary-guard-hook.cjs denies
 * `prisma generate` (and any install) as a shared-tree write. Measured
 * 2026-10-11 against the real hook, cwd = a temporaid worktree:
 *
 *   pnpm exec prisma generate  -> DENY (prisma)
 *   pnpm install               -> DENY (package_install)
 *   pnpm exec vitest run       -> allow
 *
 * Nobody generated it, so `C:\Projects\temporaid` had `apps/server/prisma/
 * schema.prisma` and no client at the hoisted path. Tests importing the client
 * failed with an environment error, the verifier honestly reported ⚠️未検証 /
 * ❌, and the verdict detector read that as a partial failure: 5 of the 15
 * verify bounces in the 24 h to 2026-10-11 were this one cause.
 *
 * The guard is NOT relaxed — the denial is correct for a link-shared tree. The
 * root is where the tree is real, and that is where this runs.
 *
 * NOT responsible for reading the project's prisma state (project-prisma-schema),
 * for installing dependencies (project-dependency-bootstrap), or for rapitas
 * worktrees (scripts/setup-worktree.cjs).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createLogger } from '../../../../../config/logger';
import { resolveInstallCommand } from './project-manifests';
import {
  findPrismaSchemas,
  fingerprintSchemas,
  nearestPackageDir,
  prismaClientPresent,
} from './project-prisma-schema';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/project-prisma-client');

/** Engine downloads on a cold cache dominate; capped so a hung generate cannot block a launch. */
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATE_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Where the generated fingerprint is recorded. Inside node_modules on purpose:
 * gitignored by construction, and deleting node_modules (which also deletes the
 * client) correctly invalidates it.
 */
const FINGERPRINT_FILE = join('node_modules', '.rapitas-prisma-fingerprint');

/**
 * package.json script names that generate a client, most specific first. A bare
 * `generate` counts only when its body actually mentions prisma — projects use
 * that name for codegen of every kind.
 */
const GENERATE_SCRIPTS = ['db:generate', 'prisma:generate', 'generate:prisma', 'generate'];

/** What a generate run did, for logging and tests. */
export interface PrismaClientResult {
  action: 'generated' | 'skipped' | 'failed';
  detail: string;
}

/** One generate invocation: the command and the directory to run it in. */
export interface GenerateInvocation {
  command: string;
  cwd: string;
  /** Why this form was chosen, for the log line. / 選択理由 */
  via: 'project-script' | 'prisma-exec';
}

/**
 * How to generate the client for one schema.
 *
 * Prefers the project's OWN script: it may point at a custom output, set env, or
 * generate several clients, none of which a bare `prisma generate` reproduces.
 * Falls back to invoking prisma through the project's package manager.
 *
 * @param root - Project root / プロジェクトルート
 * @param schemaRel - Relative schema path or folder / スキーマの相対パス
 * @returns The invocation to run / 実行する内容
 */
export function prismaGenerateInvocation(root: string, schemaRel: string): GenerateInvocation {
  const pkgDir = nearestPackageDir(root, dirname(join(root, schemaRel)));
  const pm = resolveInstallCommand(root).split(' ')[0];

  for (const dir of pkgDir === root ? [root] : [pkgDir, root]) {
    let scripts: Record<string, unknown> | undefined;
    try {
      scripts = (
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: unknown }
      ).scripts as Record<string, unknown> | undefined;
    } catch {
      continue;
    }
    if (!scripts) continue;
    for (const name of GENERATE_SCRIPTS) {
      const body = scripts[name];
      if (typeof body !== 'string') continue;
      // `generate` is a generic name; require it to actually be prisma's.
      if (name === 'generate' && !/prisma/i.test(body)) continue;
      return { command: `${pm} run ${name}`, cwd: dir, via: 'project-script' };
    }
  }

  // --schema is passed relative to the cwd so the command stays readable in logs
  // and does not embed a machine-specific absolute path.
  const rel = relative(pkgDir, join(root, schemaRel)).split('\\').join('/');
  return {
    command: `${pm} exec prisma generate --schema "${rel}"`,
    cwd: pkgDir,
    via: 'prisma-exec',
  };
}

/** Injectable pieces of {@link ensurePrismaClient}; tests avoid a real package manager. */
export interface EnsurePrismaClientOpts {
  /** Runs one invocation; rejects on a non-zero exit. / 1件を実行 */
  run?: (invocation: GenerateInvocation) => Promise<void>;
}

/** Default runner: the project's package manager, in the invocation's own cwd. */
async function runGenerate(invocation: GenerateInvocation): Promise<void> {
  await execAsync(invocation.command, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    timeout: GENERATE_TIMEOUT_MS,
    maxBuffer: GENERATE_BUFFER_BYTES,
  });
}

/**
 * Generate the project's Prisma client when its schema set changed or no client
 * exists yet.
 *
 * Fails SOFT and never throws: a missing client leaves specific gates
 * unverifiable, which the verifier reports, whereas throwing here would block
 * the agent launch outright and lose the whole task. The failure is logged and
 * returned so the caller can say so.
 *
 * @param root - Project root whose node_modules is the real tree / プロジェクトルート
 * @param opts - Injectable runner / テスト用の注入
 * @returns What was done / 実施内容
 */
export async function ensurePrismaClient(
  root: string,
  opts: EnsurePrismaClientOpts = {},
): Promise<PrismaClientResult> {
  const schemas = findPrismaSchemas(root);
  if (schemas.length === 0) return { action: 'skipped', detail: 'no prisma schema' };

  const wanted = fingerprintSchemas(root, schemas);
  let recorded = '';
  try {
    recorded = readFileSync(join(root, FINGERPRINT_FILE), 'utf8').trim();
  } catch {
    /* never generated here */
  }
  if (wanted === recorded && prismaClientPresent(root, schemas)) {
    return { action: 'skipped', detail: 'client up to date' };
  }

  const run = opts.run ?? runGenerate;
  const ran: string[] = [];
  for (const schemaRel of schemas) {
    const invocation = prismaGenerateInvocation(root, schemaRel);
    try {
      await run(invocation);
      ran.push(`${schemaRel} via ${invocation.via}`);
    } catch (err) {
      // A kept client is a different situation from none at all, and only the
      // second one makes every db-backed gate unverifiable. On Windows a
      // generate routinely fails EPERM unlinking query_engine-windows.dll.node
      // while a process holds it (measured on temporaid 2026-10-11) — with a
      // client already in place that is a stale-client risk, not a blocked gate.
      const kept = prismaClientPresent(root, schemas);
      const detail = kept
        ? `${invocation.command} failed for ${schemaRel}; existing client kept (may be stale)`
        : `${invocation.command} failed for ${schemaRel}; no client present — db-backed gates will be unverifiable`;
      const fields = {
        err,
        root,
        schema: schemaRel,
        command: invocation.command,
        cwd: invocation.cwd,
      };
      if (kept) logger.warn(fields, `[projectPrismaClient] ${detail}`);
      else logger.error(fields, `[projectPrismaClient] ${detail}`);
      return { action: 'failed', detail };
    }
  }

  try {
    // A workspace-only root can have no node_modules of its own (the client
    // lands beside the package that owns the schema), and writing into a missing
    // directory throws ENOENT — which silently cost the skip and regenerated on
    // every launch.
    mkdirSync(dirname(join(root, FINGERPRINT_FILE)), { recursive: true });
    writeFileSync(join(root, FINGERPRINT_FILE), wanted, 'utf8');
  } catch (err) {
    // Non-fatal: the next launch regenerates, which is correct but slower.
    logger.warn({ err, root }, '[projectPrismaClient] Could not record the schema fingerprint');
  }
  logger.info(
    `[projectPrismaClient] generated ${ran.length} client(s) in ${root}: ${ran.join(', ')}`,
  );
  return { action: 'generated', detail: ran.join(', ') };
}
