/**
 * check-ssot-drift
 *
 * Scans three constant domains for SSOT drift — definitions or literals that
 * should have been replaced by named imports from the SSOT modules:
 *
 *   Domain A: WorkflowRole / WorkflowStatus / WorkflowMode local type aliases
 *             outside services/workflow/workflow-types.ts
 *
 *   Domain B: Bare numeric HTTP status literals (`set.status = <number>`)
 *             in route and middleware files
 *
 *   Domain C: Known error-message string literals that have a named SSOT
 *             constant in utils/common/error-messages.ts
 *
 * Usage:
 *   bun scripts/check-ssot-drift.ts              # warn-only (default), exit 0
 *   bun scripts/check-ssot-drift.ts --check      # strict mode, exit 1 on violation
 *   bun scripts/check-ssot-drift.ts --warn-only  # explicit warn-only, exit 0
 *
 * The `--check` flag is intended for CI gates after the full migration is done.
 * Until all files are migrated, run in warn-only mode to avoid noisy CI failures.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

const CHECK_MODE = process.argv.includes('--check');
const WARN_ONLY = process.argv.includes('--warn-only') || !CHECK_MODE;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively collect all .ts files under dir, excluding node_modules and .d.ts */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Read file content; return '' on error. */
function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Relative path from ROOT for display, normalized to forward slashes. */
function rel(path: string): string {
  return path
    .replace(ROOT + '/', '')
    .replace(ROOT + '\\', '')
    .replace(/\\/g, '/');
}

// ── Domain A ─────────────────────────────────────────────────────────────────
// Detect local `type WorkflowRole|WorkflowStatus|WorkflowMode` definitions
// outside the canonical SSOT file.

const SSOT_TYPE_FILE = 'services/workflow/workflow-types.ts';
// Re-export wrappers are exempted: they only `import type {...} from '...'` without redefining.
const SSOT_TYPE_EXEMPTIONS = new Set([
  'services/agents/capabilities/agent-capabilities.ts', // re-export only
]);

const DOMAIN_A_PATTERN = /\btype\s+(WorkflowRole|WorkflowStatus|WorkflowMode)\s*=/;

function scanDomainA(): { file: string; match: string }[] {
  const violations: { file: string; match: string }[] = [];
  const files = [
    ...collectTsFiles(join(ROOT, 'services')),
    ...collectTsFiles(join(ROOT, 'routes')),
    ...collectTsFiles(join(ROOT, 'middleware')),
    ...collectTsFiles(join(ROOT, 'utils')),
  ];

  for (const file of files) {
    const relPath = rel(file);
    if (relPath === SSOT_TYPE_FILE) continue;
    if (SSOT_TYPE_EXEMPTIONS.has(relPath)) continue;

    const content = read(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = DOMAIN_A_PATTERN.exec(lines[i]);
      if (m) {
        violations.push({ file: `${relPath}:${i + 1}`, match: m[0].trim() });
      }
    }
  }
  return violations;
}

// ── Domain B ─────────────────────────────────────────────────────────────────
// Detect `set.status = <number>` or `status: <number>` literals in route/middleware.
// Only looks for the status codes that HTTP_STATUS covers.

const HTTP_CODES = new Set([200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500]);
// Matches: `set.status = 404` or `context.set.status = 422` or `status: 401`
const DOMAIN_B_PATTERN = /(?:set\.status\s*=\s*|status:\s*)(\d{3})\b/g;

function scanDomainB(): { file: string; match: string }[] {
  const violations: { file: string; match: string }[] = [];
  const files = [
    ...collectTsFiles(join(ROOT, 'routes')),
    ...collectTsFiles(join(ROOT, 'middleware')),
  ];

  for (const file of files) {
    const relPath = rel(file);
    // Skip test files — they may intentionally use numeric codes in assertions
    if (relPath.includes('.test.') || relPath.includes('.spec.')) continue;
    // Skip the SSOT file itself
    if (relPath === 'utils/common/http-status.ts') continue;

    const content = read(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      DOMAIN_B_PATTERN.lastIndex = 0;
      while ((m = DOMAIN_B_PATTERN.exec(line)) !== null) {
        const code = parseInt(m[1]);
        if (HTTP_CODES.has(code)) {
          violations.push({ file: `${relPath}:${i + 1}`, match: m[0].trim() });
        }
      }
    }
  }
  return violations;
}

// ── Domain C ─────────────────────────────────────────────────────────────────
// Detect known error-message string literals that should be imported from
// utils/common/error-messages.ts.

const KNOWN_MESSAGES = [
  'タスクが見つかりません',
  '無効なIDです',
  'Resource not found',
  'Validation error',
];

function escapeRegex(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function scanDomainC(): { file: string; match: string }[] {
  const violations: { file: string; match: string }[] = [];
  const files = [
    ...collectTsFiles(join(ROOT, 'routes')),
    ...collectTsFiles(join(ROOT, 'services')),
    ...collectTsFiles(join(ROOT, 'middleware')),
    ...collectTsFiles(join(ROOT, 'utils')),
  ];

  for (const file of files) {
    const relPath = rel(file);
    // Skip the SSOT file and test files
    if (relPath === 'utils/common/error-messages.ts') continue;
    if (relPath.includes('.test.') || relPath.includes('.spec.')) continue;

    const content = read(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const msg of KNOWN_MESSAGES) {
        if (escapeRegex(msg).test(lines[i])) {
          violations.push({ file: `${relPath}:${i + 1}`, match: `"${msg}"` });
        }
      }
    }
  }
  return violations;
}

// ── Domain D ─────────────────────────────────────────────────────────────────
// Detect runtime constants and type aliases that must be sourced from
// services/workflow/workflow-types.ts:
//   D1. VALID_WORKFLOW_STATUSES defined as a local array literal (not a re-export alias)
//   D2. WorkflowFileType defined as an inline string-union type alias
//   D3. Inline workflow-modes array literal ['lightweight', 'standard', 'comprehensive']

// workflow-types.ts is the SSOT — its own definitions are not violations.
const DOMAIN_D_SSOT_FILE = 'services/workflow/workflow-types.ts';

const DOMAIN_D_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    // Matches `VALID_WORKFLOW_STATUSES = [` (local array definition, not alias assignment)
    pattern: /\bVALID_WORKFLOW_STATUSES\s*=\s*\[/,
    label: 'VALID_WORKFLOW_STATUSES local array definition',
  },
  {
    // Matches `type WorkflowFileType = '...'` (inline string-union definition)
    pattern: /\btype\s+WorkflowFileType\s*=\s*['"]/,
    label: 'WorkflowFileType local union type definition',
  },
  {
    // Matches the inline three-element modes array literal in source code
    pattern: /\[['"]lightweight['"]\s*,\s*['"]standard['"]\s*,\s*['"]comprehensive['"]\]/,
    label: "inline ['lightweight','standard','comprehensive'] modes array",
  },
];

function scanDomainD(): { file: string; match: string }[] {
  const violations: { file: string; match: string }[] = [];
  const files = [
    ...collectTsFiles(join(ROOT, 'services')),
    ...collectTsFiles(join(ROOT, 'routes')),
  ];

  for (const file of files) {
    const relPath = rel(file);
    if (relPath === DOMAIN_D_SSOT_FILE) continue;
    if (relPath.includes('.test.') || relPath.includes('.spec.')) continue;

    const content = read(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, label } of DOMAIN_D_PATTERNS) {
        if (pattern.test(lines[i])) {
          violations.push({ file: `${relPath}:${i + 1}`, match: label });
          break;
        }
      }
    }
  }
  return violations;
}

// ── Runner ────────────────────────────────────────────────────────────────────

const mode = CHECK_MODE ? 'check' : 'warn-only';
console.log(`check-ssot-drift [${mode}] — scanning 4 constant domains\n`);

const domainAViolations = scanDomainA();
const domainBViolations = scanDomainB();
const domainCViolations = scanDomainC();
const domainDViolations = scanDomainD();

function report(label: string, violations: { file: string; match: string }[]): void {
  console.log(`${label}: ${violations.length} violation(s)`);
  if (violations.length > 0) {
    for (const v of violations.slice(0, 20)) {
      const prefix = WARN_ONLY ? '  ⚠️ ' : '  ❌';
      console.log(`${prefix} ${v.file}  →  ${v.match}`);
    }
    if (violations.length > 20) {
      console.log(`  ... and ${violations.length - 20} more`);
    }
  }
}

report('Domain A (WorkflowRole/Status/Mode type drift)', domainAViolations);
report('Domain B (HTTP status numeric literals)', domainBViolations);
report('Domain C (error message string literals)', domainCViolations);
report('Domain D (WorkflowFileType/VALID_STATUSES/inline-modes drift)', domainDViolations);

const total =
  domainAViolations.length +
  domainBViolations.length +
  domainCViolations.length +
  domainDViolations.length;
const exitCode = total === 0 || WARN_ONLY ? 0 : 1;
const icon = total === 0 ? '✅' : WARN_ONLY ? '⚠️ ' : '❌';

console.log(`\nResult: ${icon} ${total} total violation(s) (EXIT=${exitCode})`);

if (total > 0 && WARN_ONLY) {
  console.log('[warn-only mode] Violations detected but exiting 0.');
} else if (total > 0 && !WARN_ONLY) {
  console.log(
    'Replace the listed literals with named imports from utils/common/http-status.ts,' +
      '\nutils/common/error-messages.ts, and services/workflow/workflow-types.ts.',
  );
}

process.exit(exitCode);
