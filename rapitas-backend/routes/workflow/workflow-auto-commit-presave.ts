/**
 * Workflow Auto Commit — pre-save stage
 *
 * Runs BEFORE the task's working tree is saved as a local commit: the
 * protected-path tripwire and the plan-scope check on the exact diff about to
 * be recorded, plus a secret-material screen so a bulk `git add -A` can never
 * capture credentials. Then records the local commit on the task branch only
 * (no push, no PR). Not responsible for the verification gate, base sync, or
 * publication — see workflow-auto-commit.ts for the ordering.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import {
  getAllChangedFiles,
  tamperCheck,
  type VerificationCheck,
} from '../../services/agents/verification/automated-verifier';
import { evaluateScopeCheck, parsePlanFiles } from '../../services/agents/verification/scope-check';
import {
  loadPlanContent,
  protectedTestPathsFromSpec,
} from '../../services/agents/verification/verification-gate';
import { parseSpecArray } from '../../utils/common/spec-array';

const log = createLogger('routes:workflow:auto-commit:presave');

/** File names that must never be bulk-staged from an agent worktree. */
const SECRET_PATH_RE =
  /(^|[\\/])(\.env(\.[^\\/]+)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^\\/]*credentials[^\\/]*\.(json|ya?ml|txt))$|\.(pem|key|p12|pfx|jks|keystore)$/i;
const SECRET_PATH_ALLOW_RE = /(^|[\\/])\.env\.(example|sample|template)$/i;
/** Token shapes that identify a leaked credential in changed text files. */
const SECRET_CONTENT_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-ant-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abp]-[A-Za-z0-9-]{20,}/;
const SECRET_SCAN_MAX_BYTES = 512 * 1024;
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|env|txt|md|sh|ps1|ini|cfg|conf|rs)$/i;

/** Outcome of the pre-save stage. */
export interface PreSaveCheckResult {
  /** False when a hard condition (tamper / secret) forbids saving. */
  ok: boolean;
  /** Human-readable one-line summary in the gate's `name=ok/NG(n)` style. */
  summary: string;
  changedFiles: string[];
  tamper: VerificationCheck | null;
  /** Advisory only — recorded, never blocks the save. */
  scope: VerificationCheck | null;
  /** Paths that look like secret material (blocking). */
  secrets: string[];
  /** Compact shape persisted on the auto-commit result. */
  record: { ok: boolean; summary: string; secrets: string[]; scopeDetails?: string };
}

async function scanForSecrets(gitCwd: string, files: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const rel of files) {
    if (SECRET_PATH_RE.test(rel) && !SECRET_PATH_ALLOW_RE.test(rel)) {
      hits.push(rel);
      continue;
    }
    if (!TEXT_EXT_RE.test(rel)) continue;
    const abs = join(gitCwd, rel);
    try {
      const info = await stat(abs);
      if (!info.isFile() || info.size > SECRET_SCAN_MAX_BYTES) continue;
      if (SECRET_CONTENT_RE.test(await readFile(abs, 'utf8'))) hits.push(rel);
    } catch {
      // Deleted or unreadable paths carry nothing to leak.
    }
  }
  return hits;
}

/**
 * Evaluate the working tree that is about to be committed.
 *
 * @param p - Task id, worktree, and the branch the worktree was cut from / 対象
 * @returns Hard verdict (tamper/secret) plus advisory scope diagnostics / 判定
 */
export async function runPreSaveChecks(p: {
  taskId: number;
  gitCwd: string;
  preferredBaseBranch: string | null;
}): Promise<PreSaveCheckResult> {
  const changedFiles = await getAllChangedFiles(p.gitCwd, p.preferredBaseBranch);
  const planContent = await loadPlanContent(p.taskId);
  const planFiles = planContent ? parsePlanFiles(planContent) : null;
  const task = await prisma.task
    .findUnique({
      where: { id: p.taskId },
      select: {
        title: true,
        description: true,
        goals: true,
        constraints: true,
        acceptanceCriteria: true,
      },
    })
    .catch(() => null);
  const specText = [
    task?.title ?? '',
    task?.description ?? '',
    ...parseSpecArray(task?.goals),
    ...parseSpecArray(task?.constraints),
    ...parseSpecArray(task?.acceptanceCriteria),
  ].join('\n');
  // Same allowlist rule as the gate: a plan-less task may only touch the
  // protected TEST files its own spec names.
  const allow = planContent ? [] : protectedTestPathsFromSpec(specText);
  const tamper = tamperCheck(
    changedFiles,
    allow.length ? [...(planFiles ?? []), ...allow] : planFiles,
  );
  const scope = planFiles ? evaluateScopeCheck(changedFiles, planFiles) : null;
  const secrets = await scanForSecrets(p.gitCwd, changedFiles);
  const ok = (tamper === null || tamper.ok) && secrets.length === 0;
  const summary = [
    `tamper=${tamper === null ? 'n/a' : tamper.ok ? 'ok' : `NG(${tamper.errorCount})`}`,
    `secret=${secrets.length === 0 ? 'ok' : `NG(${secrets.length})`}`,
    `scope=${scope === null ? 'n/a' : scope.ok ? 'ok' : `NG(${scope.errorCount})`}`,
  ].join(' / ');
  if (!ok) {
    log.warn(
      { taskId: p.taskId, summary, secrets, tamper: tamper?.details },
      '[presave] refusing to record the working tree — hard pre-save check failed',
    );
  } else if (scope && !scope.ok) {
    log.info(
      { taskId: p.taskId, scope: scope.details },
      '[presave] advisory scope deviation recorded',
    );
  }
  const record = { ok, summary, secrets, scopeDetails: scope?.details };
  return { ok, summary, changedFiles, tamper, scope, secrets, record };
}

/** Result of the local save. Mirrors AutoCommitPRResult.autoCommitResult. */
export interface LocalCommitOutcome {
  success: boolean;
  hash?: string;
  branch?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  alreadyCommitted?: boolean;
  error?: string;
}

/**
 * Record the task's working tree as a commit on its own branch. Local only:
 * nothing is pushed and no PR is opened here. A clean tree is a no-op success
 * on HEAD, so a re-run never stacks duplicate commits.
 *
 * @param p - Orchestrator, worktree, branch and commit message inputs / 入力
 * @returns Commit metadata or a failure with its message / 保存結果
 */
export async function saveTaskWorkLocally(p: {
  orchestrator: Pick<AgentOrchestrator, 'createBranch' | 'createCommit'>;
  gitCwd: string;
  branchName: string | null | undefined;
  message: string;
  targetBranch: string;
}): Promise<LocalCommitOutcome> {
  try {
    if (p.branchName) await p.orchestrator.createBranch(p.gitCwd, p.branchName);
    const c = await p.orchestrator.createCommit(p.gitCwd, p.message, p.targetBranch);
    return {
      success: true,
      hash: c.hash,
      branch: c.branch,
      filesChanged: c.filesChanged,
      additions: c.additions,
      deletions: c.deletions,
      alreadyCommitted: c.alreadyCommitted,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
