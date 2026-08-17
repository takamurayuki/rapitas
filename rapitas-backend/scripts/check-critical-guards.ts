/**
 * check-critical-guards
 *
 * Verifies that every critical guard function (those whose failure would cause
 * irreversible data loss or system corruption) has a dedicated test file that
 * references it. Run via: bun run check:guards
 *
 * Two-stage check per entry:
 *   Stage 1 — sourceFile exists and contains "function <name>"
 *   Stage 2 — testFile exists and the guard name appears as a string reference
 *
 * Entries with skipReason are excluded from both stages (warning only).
 * Pass --warn-only to exit 0 even when gaps are found.
 */
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// NOTE: import.meta.dir is Bun-specific; scripts/ is one level below rapitas-backend/
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

const WARN_ONLY = process.argv.includes('--warn-only');

interface GuardEntry {
  /** Function name as it appears in source */
  name: string;
  /** Source file path relative to rapitas-backend/ */
  sourceFile: string;
  /** Test file path relative to rapitas-backend/ (omit if covered by skipReason) */
  testFile?: string;
  /** Criticality level — informational only */
  severity: 'highest' | 'high';
  /** When set, both stages are skipped and only a warning is emitted */
  skipReason?: string;
}

/**
 * Registry of critical guard functions that MUST have unit test coverage.
 * Add new entries here whenever a function of this class is introduced.
 * Entries without skipReason are fully enforced (Stage 1 + Stage 2).
 */
const CRITICAL_GUARDS: GuardEntry[] = [
  // #1 — Prevents destructive git operations on the main checkout
  {
    name: 'isIsolatedWorktree',
    sourceFile: 'routes/agents/execution/research/research-output-utils.ts',
    testFile: 'routes/agents/execution/research/research-validator.test.ts',
    severity: 'highest',
  },
  // #2 — Validates worktree paths before destructive filesystem operations
  {
    name: 'isPathSafeForWorktreeOperation',
    sourceFile: 'services/agents/orchestrator/git-operations/core/safety.ts',
    testFile: 'services/agents/orchestrator/git-operations/core/safety.test.ts',
    severity: 'highest',
  },
  // #3 — Kills a process tree while refusing to kill the backend port
  {
    name: 'killProcessTreeSafely',
    sourceFile: 'services/agents/agent-process-tracker.ts',
    severity: 'highest',
    skipReason:
      'OS-dependent (tasklist/netstat/lsof via execSync) — DI refactor + platform-mocked test pending',
  },
  // #4 — Guards killProcessTreeSafely from killing the backend server
  {
    name: 'isListeningOnBackendPort',
    sourceFile: 'services/agents/agent-process-tracker.ts',
    severity: 'highest',
    skipReason:
      'OS-dependent (netstat/lsof via execSync) + private (non-exported) — DI refactor pending',
  },
  // #5 — Detects whether a directory is the PRIMARY git working tree
  {
    name: 'isPrimaryWorkTree',
    sourceFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.ts',
    testFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.test.ts',
    severity: 'highest',
  },
  // #6 — Throws before any agent git mutation on the primary working tree
  {
    name: 'ensureNotPrimaryWorkTree',
    sourceFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.ts',
    testFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.test.ts',
    severity: 'highest',
  },
  // #7 — Detects the backend's own primary checkout to prevent self-clobber
  {
    name: 'isBackendPrimaryCheckout',
    sourceFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.ts',
    testFile: 'services/agents/orchestrator/git-operations/worktree/worktree-guard.test.ts',
    severity: 'highest',
  },
  // #8 — Decides whether a recorded worktree path can be reused
  {
    name: 'canReuseWorktree',
    sourceFile: 'services/agents/orchestrator/git-operations/worktree/worktree-usable.ts',
    testFile: 'services/agents/orchestrator/git-operations/worktree/worktree-usable.test.ts',
    severity: 'high',
  },
  // #9 — Determines the worktree strategy (reuse / recreate / fallback)
  {
    name: 'decideWorktree',
    sourceFile: 'services/agents/orchestrator/git-operations/worktree/worktree-usable.ts',
    testFile: 'services/agents/orchestrator/git-operations/worktree/worktree-usable.test.ts',
    severity: 'high',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

let verified = 0;
let skipped = 0;
const errors: string[] = [];

console.log('check-critical-guards — verifying test coverage for critical guard functions\n');

for (const entry of CRITICAL_GUARDS) {
  if (entry.skipReason) {
    // NOTE: Use console.log (stdout) so SKIP lines stay in order with OK lines.
    // console.warn (stderr) interleaves with stdout in shells like PowerShell.
    console.log(`  ⚠️  SKIP  [${entry.severity}] ${entry.name}`);
    console.log(`            ${entry.skipReason}`);
    skipped++;
    continue;
  }

  // Stage 1: source file must exist and contain the function declaration
  const srcPath = join(ROOT, entry.sourceFile);
  if (!existsSync(srcPath)) {
    errors.push(
      `[${entry.name}] source file not found: ${entry.sourceFile} — registry may be stale (function renamed/moved?)`,
    );
    continue;
  }
  const src = readFileSync(srcPath, 'utf8');
  if (!src.includes(`function ${entry.name}`)) {
    errors.push(
      `[${entry.name}] "function ${entry.name}" not found in ${entry.sourceFile} — function renamed/deleted? Update registry.`,
    );
    continue;
  }

  // Stage 2: test file must exist and reference the guard name
  if (!entry.testFile) {
    errors.push(`[${entry.name}] no testFile specified in registry — add a testFile entry`);
    continue;
  }
  const testPath = join(ROOT, entry.testFile);
  if (!existsSync(testPath)) {
    errors.push(
      `[${entry.name}] test file missing: ${entry.testFile} — create a unit test that covers this guard`,
    );
    continue;
  }
  const testContent = readFileSync(testPath, 'utf8');
  if (!testContent.includes(entry.name)) {
    errors.push(
      `[${entry.name}] guard name not referenced in ${entry.testFile} — add import + describe/test that exercises this guard`,
    );
    continue;
  }

  console.log(`  ✅  OK    [${entry.severity}] ${entry.name}`);
  verified++;
}

// ── Summary ───────────────────────────────────────────────────────────────────

const exitCode = errors.length === 0 || WARN_ONLY ? 0 : 1;
const icon = errors.length === 0 ? '✅' : '❌';

console.log('');
console.log(
  `Result: ${icon} ${verified} verified ⚠️  ${skipped} skipped ❌ ${errors.length} failed (EXIT=${exitCode})`,
);

if (errors.length > 0) {
  console.log('');
  for (const err of errors) {
    if (WARN_ONLY) {
      console.warn(`  ⚠️  ${err}`);
    } else {
      console.error(`  ❌  ${err}`);
    }
  }
  if (WARN_ONLY) {
    console.log('\n[warn-only mode] Gaps detected but exiting 0.');
  } else {
    console.log(
      '\nAdd tests for the listed guards, or pass --warn-only to exit 0 in advisory mode.',
    );
  }
}

process.exit(exitCode);
