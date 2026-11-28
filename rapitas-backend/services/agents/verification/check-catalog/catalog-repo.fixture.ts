/**
 * catalog-repo.fixture
 *
 * Builds a throw-away git repository that holds the real CI scripts the
 * catalog runners call (import-graph, docs-drift, check-todos) and the minimal
 * config they read, committed as the base. Tests then add uncommitted changes
 * and run the checks against it. Contains no tests.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');

const SCRIPTS = [
  'scripts/import-graph/check-import-graph.cjs',
  'scripts/import-graph/scan-imports.cjs',
  'scripts/import-graph/find-cycles.cjs',
  'scripts/docs/check-docs-drift.cjs',
  'scripts/docs/docs-drift-repo.cjs',
  'scripts/docs/docs-drift-env.cjs',
  'scripts/check-todos.cjs',
  '.github/toolchain.json',
  '.nvmrc',
];

/** A temporary repository plus helpers to change and inspect it. */
export interface CatalogRepo {
  dir: string;
  write: (rel: string, body: string) => void;
  git: (...args: string[]) => string;
  commit: (message: string) => void;
  cleanup: () => void;
}

/**
 * Create the repository and commit the base.
 *
 * @param base - Extra repo-relative files to commit in the base / ベースに含めるファイル
 * @param opts.withScripts - Copy the CI scripts (default true) / スクリプトを写すか
 * @returns The repository handle / リポジトリ
 */
export function makeCatalogRepo(
  base: Record<string, string> = {},
  opts: { withScripts?: boolean } = {},
): CatalogRepo {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-catalog-'));
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (message: string) => {
    git('add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  };
  git('init', '-q');
  if (opts.withScripts !== false) {
    for (const rel of SCRIPTS) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(dir, rel));
    }
    write('scripts/docs/docs-drift-ignore.json', '{"paths":[],"illustrativeNameDocs":[]}\n');
    write('scripts/docs/env-baseline.json', '{"undocumented":[]}\n');
  }
  const statusDoc = 'Statuses: draft → completed\n';
  write('AGENTS.md', statusDoc);
  write('.claude/CLAUDE.md', statusDoc);
  write(
    'rapitas-backend/services/workflow/workflow-types.ts',
    "export const WORKFLOW_STATUSES = ['draft', 'completed'] as const;\n",
  );
  write('rapitas-backend/.env.example', 'KNOWN_VAR=1\n');
  write('rapitas-backend/routes/b.ts', 'export const b = 1;\n');
  write('rapitas-frontend/README.txt', 'placeholder\n');
  for (const [rel, body] of Object.entries(base)) write(rel, body);
  commit('base');
  return { dir, write, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Comment lines carrying one tag, built at run time so this file holds none. */
export function tagLines(tag: 'HACK' | 'FIXME', count: number): string {
  return Array.from({ length: count }, (_, i) => `// ${tag}: marker ${i}`).join('\n') + '\n';
}

/** A token-shaped fake credential, concatenated so no source file contains one. */
export function fakeGithubToken(): string {
  return 'gh' + 'p_' + 'A'.repeat(36);
}
