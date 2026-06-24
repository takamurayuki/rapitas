/**
 * check-docs-health
 *
 * Scans the docs/ directory for three classes of documentation health issues:
 *
 *   Domain 1 — Broken links: backtick path references inside docs that point to
 *               files that no longer exist in the repository.
 *
 *   Domain 2 — Duplicate / double-managed docs: two files where one is marked as
 *               auto-generated and both share ≥70% line-level Jaccard similarity.
 *
 *   Domain 3 — Orphaned docs [warn-only]: documents with a broken-link rate above
 *               50%, indicating the doc may have drifted beyond its useful life.
 *               Always warn-only — heuristic may produce false positives.
 *
 * Redirect stubs (files containing <!-- @deprecated redirectTo: ... -->) are
 * treated as intentional migration artifacts and excluded from all checks.
 *
 * Usage:
 *   bun scripts/check-docs-health.ts              # warn-only (default), exit 0
 *   bun scripts/check-docs-health.ts --check      # strict mode, exit 1 on violation
 *   bun scripts/check-docs-health.ts --warn-only  # explicit warn-only, exit 0
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Path to the docs directory relative to ROOT. */
export const DOCS_DIR = join(ROOT, 'docs');

const CHECK_MODE = process.argv.includes('--check');
const WARN_ONLY = process.argv.includes('--warn-only') || !CHECK_MODE;

/**
 * Minimum Jaccard line-similarity score for a pair to be flagged as duplicate.
 * NOTE: 0.7 chosen as a conservative threshold — high enough to avoid false
 * positives from structurally similar but content-distinct docs.
 */
const JACCARD_THRESHOLD = 0.7;

/** File extensions considered as documentation source files. */
const DOC_EXTENSIONS = ['.md', '.rs'];

/** Extensions that qualify a backtick token as a file-path reference. */
const PATH_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|rs|md|json|sh|yaml|yml)$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Core Functions (exported for testing) ────────────────────────────────────

/**
 * Recursively collect all documentation files (.md, .rs) under dir,
 * excluding node_modules and dotfile directories.
 *
 * @param dir - Absolute path to the directory to search.
 * @returns Sorted list of absolute file paths.
 */
export function collectDocFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDocFiles(full));
    } else if (entry.isFile() && DOC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Determine whether a doc file is a redirect stub.
 * Stubs are intentional migration artifacts and exempt from all health checks.
 *
 * @param content - Full file content.
 * @returns true if the file contains a redirect declaration.
 */
export function isRedirectStub(content: string): boolean {
  return /<!--\s*@deprecated\s+redirectTo:\s*\S+/.test(content);
}

/**
 * Extract backtick path references from doc content, excluding:
 * - Lines inside fenced code blocks (``` ... ```)
 * - Tokens that look like URLs (contain "://")
 * - Tokens without a recognized file extension
 *
 * @param content - Full file content.
 * @returns Array of {line, path} entries (1-based line numbers).
 */
export function extractDocPaths(content: string): { line: number; path: string }[] {
  const results: { line: number; path: string }[] = [];
  const lines = content.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const backtickRe = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = backtickRe.exec(lines[i])) !== null) {
      const token = m[1];
      if (token.includes('://')) continue; // URL
      if (!PATH_EXTENSIONS.test(token)) continue; // not a file path
      if (!token.includes('/')) continue; // must have at least one slash
      results.push({ line: i + 1, path: token });
    }
  }

  return results;
}

/**
 * Resolve a raw path reference from inside a doc to an absolute filesystem path.
 * Strips the `rapitas-backend/` prefix when present, then resolves against ROOT.
 *
 * @param raw  - Path as written inside the doc (e.g. "rapitas-backend/tests/x.ts").
 * @param root - Repository root absolute path.
 * @returns Absolute path.
 */
export function resolveDocPath(raw: string, root: string): string {
  const stripped = raw.startsWith('rapitas-backend/') ? raw.slice('rapitas-backend/'.length) : raw;
  return join(root, stripped);
}

/**
 * Detect broken links in a documentation file.
 * Returns an empty array for redirect stubs.
 *
 * @param _docPath - Absolute path of the document (unused but kept for API symmetry).
 * @param content  - Full file content.
 * @param root     - Repository root for path resolution.
 * @returns Array of {line, path} entries where the referenced file does not exist.
 */
export function checkBrokenLinks(
  _docPath: string,
  content: string,
  root: string,
): { line: number; path: string }[] {
  if (isRedirectStub(content)) return [];
  return extractDocPaths(content).filter(({ path }) => {
    const abs = resolveDocPath(path, root);
    return !existsSync(abs);
  });
}

/**
 * Compute the Jaccard similarity of two files based on their non-empty trimmed lines.
 *
 * @param a - Content of file A.
 * @param b - Content of file B.
 * @returns Similarity score in [0, 1].
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(
    a
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const setB = new Set(
    b
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const line of setA) {
    if (setB.has(line)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/** Pair of duplicate documents with their similarity score. */
export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
}

/**
 * Detect pairs of docs that represent double-managed content.
 * A pair is flagged when one file has an "auto-generated" header and both files
 * share a line-level Jaccard similarity ≥ JACCARD_THRESHOLD.
 *
 * @param docFiles - Absolute paths of all docs to compare.
 * @returns List of duplicate pairs with similarity scores.
 */
export function detectDuplicates(docFiles: string[]): DuplicatePair[] {
  /** Heuristic: file contains an auto-generated header comment. */
  const isAutoGenerated = (content: string): boolean =>
    /自動生成ファイル|auto.?generat/i.test(content.slice(0, 300));

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < docFiles.length; i++) {
    const contentI = read(docFiles[i]);
    if (!isAutoGenerated(contentI)) continue; // start from auto-generated side
    for (let j = 0; j < docFiles.length; j++) {
      if (i === j) continue;
      const contentJ = read(docFiles[j]);
      const score = jaccardSimilarity(contentI, contentJ);
      if (score >= JACCARD_THRESHOLD) {
        // Avoid recording both (i,j) and (j,i)
        const already = pairs.some((p) => p.a === docFiles[j] && p.b === docFiles[i]);
        if (!already) {
          pairs.push({ a: docFiles[i], b: docFiles[j], score });
        }
      }
    }
  }
  return pairs;
}

/**
 * Identify orphaned docs: non-stub files where more than 50% of their backtick
 * path references point to non-existent files.
 * Always warn-only — heuristic may produce false positives.
 *
 * @param docFiles - Absolute paths of all docs to evaluate.
 * @param root     - Repository root for path resolution.
 * @returns Absolute paths of docs considered orphaned.
 */
export function detectOrphans(docFiles: string[], root: string): string[] {
  const orphans: string[] = [];
  for (const f of docFiles) {
    const content = read(f);
    if (isRedirectStub(content)) continue;
    const refs = extractDocPaths(content);
    if (refs.length === 0) continue; // no path refs — cannot determine orphan status
    const broken = refs.filter(({ path }) => !existsSync(resolveDocPath(path, root)));
    if (broken.length / refs.length > 0.5) {
      orphans.push(f);
    }
  }
  return orphans;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const docFiles = collectDocFiles(DOCS_DIR);
  console.log(`Found ${docFiles.length} doc file(s) in docs/\n`);

  // Domain 1: Broken links
  const brokenLinks: { doc: string; line: number; path: string }[] = [];
  for (const f of docFiles) {
    const content = read(f);
    for (const { line, path } of checkBrokenLinks(f, content, ROOT)) {
      brokenLinks.push({ doc: f, line, path });
    }
  }

  const d1Label = 'Domain 1 (Broken links)';
  console.log(`${d1Label}: ${brokenLinks.length} violation(s)`);
  for (const { doc, line, path } of brokenLinks.slice(0, 20)) {
    const icon = WARN_ONLY ? '⚠️ ' : '❌';
    console.log(`  ${icon} ${rel(doc)}:${line} → \`${path}\``);
  }
  if (brokenLinks.length > 20) {
    console.log(`  ... and ${brokenLinks.length - 20} more`);
  }

  // Domain 2: Duplicate / double-managed docs
  const duplicates = detectDuplicates(docFiles);

  const d2Label = 'Domain 2 (Duplicate/double-managed docs)';
  console.log(`\n${d2Label}: ${duplicates.length} violation(s)`);
  for (const { a, b, score } of duplicates) {
    const icon = WARN_ONLY ? '⚠️ ' : '❌';
    console.log(`  ${icon} ${rel(a)} ↔ ${rel(b)}  (Jaccard=${score.toFixed(2)})`);
  }

  // Domain 3: Orphaned docs — always warn-only
  const orphans = detectOrphans(docFiles, ROOT);

  const d3Label = 'Domain 3 (Orphaned docs — broken-link rate >50%) [warn-only]';
  console.log(`\n${d3Label}: ${orphans.length} candidate(s)`);
  for (const f of orphans) {
    console.log(`  ⚠️  ${rel(f)}`);
  }

  // Exit code: only Domains 1 and 2 contribute
  const total = brokenLinks.length + duplicates.length;
  const exitCode = total === 0 || WARN_ONLY ? 0 : 1;
  const icon = total === 0 ? '✅' : WARN_ONLY ? '⚠️ ' : '❌';

  console.log(
    `\nResult: ${icon} ${total} total violation(s) in enforced domains (EXIT=${exitCode})`,
  );

  if (total > 0 && WARN_ONLY) {
    console.log('[warn-only mode] Violations detected but exiting 0.');
  } else if (total > 0 && !WARN_ONLY) {
    console.log('Fix the broken links and remove duplicate documents to pass the strict check.');
  }

  process.exit(exitCode);
}
