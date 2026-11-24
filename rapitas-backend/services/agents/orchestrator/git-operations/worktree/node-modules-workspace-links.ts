/**
 * node-modules-workspace-links
 *
 * Decides which node_modules entries are workspace packages and where a
 * worktree's copy of them must point; also tells whether an existing worktree
 * still points them at the main checkout.
 * NOT responsible for creating or removing links — node-modules-root-entries
 * and node-modules-link do that.
 */
import * as fs from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { isManagedRoot, type EntryResolver } from './node-modules-root-entries';

/**
 * The project root that owns `worktreePath`, i.e. the parent of `.worktrees/`.
 *
 * Lives here, not in project-dependency-bootstrap, so the reuse preflight can
 * ask without loading the installer and Prisma chain.
 *
 * @param worktreePath - Worktree (or project) path / worktree のパス
 * @returns Owning project root, or the path itself when it is not a worktree / 所有プロジェクトのルート
 */
export function projectRootOf(worktreePath: string): string {
  for (const marker of [`${sep}.worktrees${sep}`, '/.worktrees/']) {
    const idx = worktreePath.indexOf(marker);
    if (idx > 0) return worktreePath.slice(0, idx);
  }
  return worktreePath;
}

/**
 * Build the resolver for one project/worktree pair.
 *
 * NOTE: pnpm links a workspace dependency by a RELATIVE path
 * (`../../../../packages/core`). Linking its parent directory to the main tree
 * makes that path resolve inside the main checkout, so build and E2E read the
 * develop sources instead of the branch (TempoRaid 1420, 2026-11-24).
 *
 * An entry is a workspace package when it is a symlink whose real path is
 * inside the project root and has no `node_modules` segment (`.pnpm` stores,
 * `file:`/`link:` targets outside the project and installed copies are not).
 * The worktree counterpart must exist, otherwise the main entry is kept so
 * no dangling link is made.
 *
 * @param mainRoot - Project root owning the install / インストール元のルート
 * @param worktreeRoot - Worktree to point at / 向け先の worktree
 * @returns Resolver for entries of the main node_modules / エントリの行き先解決
 */
export function workspaceResolver(mainRoot: string, worktreeRoot: string): EntryResolver {
  let mainReal: string;
  try {
    mainReal = fs.realpathSync(mainRoot);
  } catch {
    return () => null;
  }
  return (from) => {
    try {
      if (!fs.lstatSync(from).isSymbolicLink()) return null;
      const rel = relative(mainReal, fs.realpathSync(from));
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
      if (rel.split(sep).includes('node_modules')) return null;
      const dest = join(worktreeRoot, rel);
      return fs.existsSync(dest) ? dest : null;
    } catch {
      return null;
    }
  };
}

/**
 * 単一エントリに対応する worktree 側のワークスペースパッケージを返す。
 *
 * @param entryPath - メイン側の node_modules エントリ
 * @param mainRoot - メイン側のプロジェクトルート
 * @param worktreeRoot - 対応先の worktree ルート
 * @returns 対応先が実在する場合はそのパス、それ以外は null
 */
export function resolveWorkspaceTarget(
  entryPath: string,
  mainRoot: string,
  worktreeRoot: string,
): string | null {
  return workspaceResolver(mainRoot, worktreeRoot)(entryPath);
}

/** Expected worktree locations (relative to the node_modules) of every workspace entry. */
function workspaceEntries(target: string, resolve: EntryResolver): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of fs.readdirSync(target)) {
    const from = join(target, name);
    // スコープはリンク先もコンテナとして扱い、親ではなく子パッケージを判定する。
    if (name.startsWith('@') && fs.statSync(from).isDirectory()) {
      for (const kid of fs.readdirSync(from)) {
        const kidDest = resolve(join(from, kid));
        if (kidDest) found.set(`${name}/${kid}`, kidDest);
      }
      continue;
    }
    const dest = resolve(from);
    if (dest) found.set(name, dest);
  }
  return found;
}

/** True when `path` is a link that does not resolve to `expected`. */
function pointsElsewhere(path: string, expected: string): boolean {
  try {
    if (!fs.lstatSync(path).isSymbolicLink()) return true;
    return fs.realpathSync(path) !== fs.realpathSync(expected);
  } catch {
    return true;
  }
}

/**
 * 全階層の workspace リンクと、パッケージ配下の旧 junction を検査する。
 * worktree 側ターゲットが消失した場合もメインへの復帰を検査対象に含める。
 *
 * @param source - Project root / プロジェクトルート
 * @param worktree - Worktree to check / 対象 worktree
 * @param dirs - Relative dirs owning a node_modules in `source`, '' included / 相対パス
 * @returns Whether the packages must be re-linked / 張り直しが必要か
 */
export function packagesNeedRelinkIn(source: string, worktree: string, dirs: string[]): boolean {
  if (source === worktree) return false;
  const resolve = workspaceResolver(source, worktree);
  const fallback = workspaceResolver(source, source);
  for (const rel of dirs) {
    const target = join(source, rel, 'node_modules');
    const link = join(worktree, rel, 'node_modules');
    try {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink()) {
        if (fs.realpathSync(link) === fs.realpathSync(target)) return true;
        continue;
      }
      if (!isManagedRoot(link)) continue;
      for (const [name, dest] of workspaceEntries(
        target,
        (from) => resolve(from) ?? fallback(from),
      )) {
        if (pointsElsewhere(join(link, name), dest)) return true;
      }
    } catch (err) {
      // 解除後にも残る親を確認し、未チェックアウトのパッケージとは区別する。
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && fs.existsSync(join(worktree, rel))) {
        return true;
      }
      continue;
    }
  }
  return false;
}
