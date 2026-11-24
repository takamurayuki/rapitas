/**
 * node-modules-workspace-link.test
 *
 * TempoRaid 1420 (2026-11-24): a worktree's `apps/server/node_modules` was one
 * junction to the main tree, so pnpm's relative workspace link
 * `@scope/core -> ../../../../packages/core` resolved inside the MAIN checkout
 * and build/E2E read develop's sources instead of the branch's. Driven against
 * real directories and links, as in node-modules-link.test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverInstalledDirs, linkNodeModules, packagesNeedRelink } from './node-modules-link';
import { unlinkRootEntries } from './node-modules-root-entries';
import { resolveWorkspaceTarget, workspaceResolver } from './node-modules-workspace-links';

let base: string;
let main: string;
let worktree: string;

/** Remove a fixture without following a single link. */
function removeTree(p: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
  } else if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) removeTree(path.join(p, name));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}

/** pnpm's relative directory link; falls back to a junction where symlinks need privilege. */
function relativeLink(relTarget: string, at: string): void {
  try {
    fs.symlinkSync(relTarget, at, 'dir');
  } catch {
    fs.symlinkSync(path.resolve(path.dirname(at), relTarget), at, 'junction');
  }
}

const real = (p: string): string => fs.realpathSync(p);
const serverNm = (root: string): string => path.join(root, 'apps', 'server', 'node_modules');

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-ws-'));
  main = path.join(base, 'proj');
  worktree = path.join(main, '.worktrees', 'task-1534-aaaa');
  for (const root of [main, worktree]) {
    fs.mkdirSync(path.join(root, 'packages', 'core'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', 'core', 'index.ts'),
      root === main ? 'main' : 'wt',
    );
    fs.mkdirSync(path.join(root, 'apps', 'server'), { recursive: true });
  }
  const nm = serverNm(main);
  fs.mkdirSync(path.join(nm, '.bin'), { recursive: true });
  fs.mkdirSync(path.join(nm, 'zod'), { recursive: true });
  fs.mkdirSync(path.join(nm, '@scope'), { recursive: true });
  relativeLink('../../../../packages/core', path.join(nm, '@scope', 'core'));
});

afterEach(() => removeTree(base));

/** スコープ自体がリンクになっているメイン側の依存を再現する。 */
function makeLinkedScope(
  rel: string,
  outsideModules: boolean,
): { mainScope: string; worktreeScope: string } {
  const nm = path.join(main, rel, 'node_modules');
  const mainScope = path.join(nm, '@scope');
  if (!fs.existsSync(mainScope)) {
    fs.mkdirSync(mainScope, { recursive: true });
    fs.symlinkSync(path.join(main, 'packages', 'core'), path.join(mainScope, 'core'), 'junction');
  }
  const backing = path.join(outsideModules ? main : nm, '.scope-store');
  fs.renameSync(mainScope, backing);
  removeTree(path.join(backing, 'core'));
  relativeLink(
    path.relative(backing, path.join(main, 'packages', 'core')),
    path.join(backing, 'core'),
  );
  relativeLink(path.relative(nm, backing), mainScope);
  fs.mkdirSync(path.join(mainScope, 'ordinary'));
  fs.writeFileSync(path.join(mainScope, 'ordinary', 'index.js'), 'dependency');
  return { mainScope, worktreeScope: path.join(worktree, rel, 'node_modules', '@scope') };
}

describe.each([false, true])(
  'メイン側のスコープ自体がリンクの場合（node_modules外=%s）',
  (outsideModules) => {
    it.each(['', 'apps/server'])(
      '%s の workspace だけを展開し、解除時もメインを保持する',
      (rel) => {
        const { mainScope, worktreeScope } = makeLinkedScope(rel, outsideModules);
        expect(fs.lstatSync(mainScope).isSymbolicLink()).toBe(true);

        linkNodeModules(main, worktree);

        expect(real(path.join(worktreeScope, 'core'))).toBe(
          real(path.join(worktree, 'packages', 'core')),
        );
        expect(fs.lstatSync(worktreeScope).isDirectory()).toBe(true);
        expect(fs.readFileSync(path.join(worktreeScope, 'core', 'index.ts'), 'utf8')).toBe('wt');
        expect(real(path.join(worktreeScope, 'ordinary'))).toBe(
          real(path.join(mainScope, 'ordinary')),
        );
        expect(packagesNeedRelink(main, worktree)).toBe(false);
        linkNodeModules(main, worktree);
        expect(real(path.join(worktreeScope, 'core'))).toBe(
          real(path.join(worktree, 'packages', 'core')),
        );

        expect(unlinkRootEntries(path.dirname(worktreeScope))).toBe(true);
        expect(fs.existsSync(worktreeScope)).toBe(false);
        expect(fs.readFileSync(path.join(mainScope, 'ordinary', 'index.js'), 'utf8')).toBe(
          'dependency',
        );
        expect(fs.readFileSync(path.join(mainScope, 'core', 'index.ts'), 'utf8')).toBe('main');
        expect(fs.readFileSync(path.join(worktree, 'packages', 'core', 'index.ts'), 'utf8')).toBe(
          'wt',
        );
      },
    );

    it.each(['', 'apps/server'])('%s の旧共有スコープを再リンク対象として検出する', (rel) => {
      const { mainScope, worktreeScope } = makeLinkedScope(rel, outsideModules);
      linkNodeModules(main, worktree);
      removeTree(worktreeScope);
      fs.symlinkSync(mainScope, worktreeScope, 'junction');

      expect(packagesNeedRelink(main, worktree)).toBe(true);

      linkNodeModules(main, worktree);
      expect(real(path.join(worktreeScope, 'core'))).toBe(
        real(path.join(worktree, 'packages', 'core')),
      );
      expect(packagesNeedRelink(main, worktree)).toBe(false);
    });

    it('通常依存だけのリンクスコープは共有リンクのまま保持する', () => {
      const { mainScope, worktreeScope } = makeLinkedScope('apps/server', outsideModules);
      removeTree(path.join(mainScope, 'core'));
      // 同位置のコンテナが存在しても、通常依存のスコープ全体を worktree へ向けない。
      fs.mkdirSync(path.join(worktree, '.scope-store', 'ordinary'), { recursive: true });

      linkNodeModules(main, worktree);

      expect(fs.lstatSync(worktreeScope).isSymbolicLink()).toBe(true);
      expect(real(worktreeScope)).toBe(real(mainScope));
      expect(packagesNeedRelink(main, worktree)).toBe(false);
    });
  },
);

describe('linkNodeModules — workspace packages', () => {
  it('points a workspace link at the worktree and an ordinary dependency at main', () => {
    const linked = linkNodeModules(main, worktree);

    expect(linked).toContain('apps/server');
    const core = path.join(serverNm(worktree), '@scope', 'core');
    expect(real(core)).toBe(real(path.join(worktree, 'packages', 'core')));
    expect(fs.readFileSync(path.join(core, 'index.ts'), 'utf8')).toBe('wt');
    expect(real(path.join(serverNm(worktree), 'zod'))).toBe(real(path.join(serverNm(main), 'zod')));
    // main is untouched
    expect(fs.readFileSync(path.join(main, 'packages', 'core', 'index.ts'), 'utf8')).toBe('main');
  });

  it('is idempotent', () => {
    linkNodeModules(main, worktree);
    const first = fs.readdirSync(serverNm(worktree)).sort();
    expect(linkNodeModules(main, worktree)).toContain('apps/server');
    expect(fs.readdirSync(serverNm(worktree)).sort()).toEqual(first);
    expect(real(path.join(serverNm(worktree), '@scope', 'core'))).toBe(
      real(path.join(worktree, 'packages', 'core')),
    );
  });

  it('keeps the main entry when the worktree has no such package', () => {
    removeTree(path.join(worktree, 'packages', 'core'));
    linkNodeModules(main, worktree);
    expect(real(path.join(serverNm(worktree), '@scope', 'core'))).toBe(
      real(path.join(main, 'packages', 'core')),
    );
  });

  it('keeps a scope that holds no workspace package as one link to main', () => {
    const other = path.join(serverNm(main), '@types', 'node');
    fs.mkdirSync(other, { recursive: true });
    linkNodeModules(main, worktree);
    const scope = path.join(serverNm(worktree), '@types');
    expect(fs.lstatSync(scope).isSymbolicLink()).toBe(true);
    expect(real(path.join(scope, 'node'))).toBe(real(other));
  });

  it('replaces an old whole-directory junction without touching main', () => {
    fs.symlinkSync(serverNm(main), serverNm(worktree), 'junction');
    expect(packagesNeedRelink(main, worktree)).toBe(true);

    linkNodeModules(main, worktree);

    expect(fs.lstatSync(serverNm(worktree)).isSymbolicLink()).toBe(false);
    expect(real(path.join(serverNm(worktree), '@scope', 'core'))).toBe(
      real(path.join(worktree, 'packages', 'core')),
    );
    expect(fs.existsSync(path.join(serverNm(main), 'zod'))).toBe(true);
    expect(fs.existsSync(path.join(main, 'packages', 'core', 'index.ts'))).toBe(true);
  });
});

describe('packagesNeedRelink', () => {
  it('worktree に存在しないパッケージを再リンク対象にしない', () => {
    removeTree(path.join(worktree, 'apps', 'server'));
    fs.mkdirSync(path.join(worktree, 'node_modules', '.bin'), { recursive: true });
    expect(packagesNeedRelink(main, worktree)).toBe(false);
  });

  it('junction 解除直後の中断で node_modules が欠けても再作成する', () => {
    linkNodeModules(main, worktree);
    removeTree(serverNm(worktree));
    expect(packagesNeedRelink(main, worktree)).toBe(true);
    linkNodeModules(main, worktree);
    expect(real(path.join(serverNm(worktree), '@scope', 'core'))).toBe(
      real(path.join(worktree, 'packages', 'core')),
    );
    expect(packagesNeedRelink(main, worktree)).toBe(false);
  });

  it.each(['core', '@scope/core'])('ルートの %s がメインを指していれば張り直す', (name) => {
    const mainNm = path.join(main, 'node_modules');
    fs.mkdirSync(path.dirname(path.join(mainNm, name)), { recursive: true });
    fs.symlinkSync(path.join(main, 'packages', 'core'), path.join(mainNm, name), 'junction');
    linkNodeModules(main, worktree);
    expect(packagesNeedRelink(main, worktree)).toBe(false);

    const core = path.join(worktree, 'node_modules', name);
    removeTree(core);
    fs.symlinkSync(path.join(main, 'packages', 'core'), core, 'junction');
    expect(packagesNeedRelink(main, worktree)).toBe(true);

    linkNodeModules(main, worktree);
    expect(real(core)).toBe(real(path.join(worktree, 'packages', 'core')));
    expect(packagesNeedRelink(main, worktree)).toBe(false);
  });

  it('リンク先が消失した場合も再リンクが必要と判定する', () => {
    linkNodeModules(main, worktree);
    removeTree(path.join(worktree, 'packages', 'core'));
    expect(packagesNeedRelink(main, worktree)).toBe(true);
  });

  it('リンク先消失後の再同期で既存スコープの子リンクをメインへ戻す', () => {
    linkNodeModules(main, worktree);
    removeTree(path.join(worktree, 'packages', 'core'));

    linkNodeModules(main, worktree);

    const core = path.join(serverNm(worktree), '@scope', 'core');
    expect(real(core)).toBe(real(path.join(main, 'packages', 'core')));
    expect(fs.readFileSync(path.join(core, 'index.ts'), 'utf8')).toBe('main');
    expect(packagesNeedRelink(main, worktree)).toBe(false);
    linkNodeModules(main, worktree);
    expect(real(core)).toBe(real(path.join(main, 'packages', 'core')));

    fs.mkdirSync(path.join(worktree, 'packages', 'core'));
    expect(packagesNeedRelink(main, worktree)).toBe(true);
    linkNodeModules(main, worktree);
    expect(real(core)).toBe(real(path.join(worktree, 'packages', 'core')));
    expect(packagesNeedRelink(main, worktree)).toBe(false);
  });

  it('is false once linked and true when a workspace link points into main', () => {
    linkNodeModules(main, worktree);
    expect(packagesNeedRelink(main, worktree)).toBe(false);

    const core = path.join(serverNm(worktree), '@scope', 'core');
    fs.unlinkSync(core);
    fs.symlinkSync(path.join(main, 'packages', 'core'), core, 'junction');
    expect(packagesNeedRelink(main, worktree)).toBe(true);
  });

  it('is false for the project itself', () => {
    expect(packagesNeedRelink(main, main)).toBe(false);
  });
});

describe('ワークスペースの判定境界', () => {
  it.each([
    ['@scope/core', true],
    ['zod', false],
    ['missing', false],
  ] as const)('resolveWorkspaceTarget は %s の対応先を判定する', (name, workspace) => {
    const target = resolveWorkspaceTarget(path.join(serverNm(main), name), main, worktree);
    expect(target).toBe(workspace ? path.join(worktree, 'packages', 'core') : null);
  });

  it('同一スコープ内の通常依存はメインに残す', () => {
    const dependency = path.join(serverNm(main), '@scope', 'ordinary');
    fs.mkdirSync(dependency);
    linkNodeModules(main, worktree);
    expect(real(path.join(serverNm(worktree), '@scope', 'ordinary'))).toBe(real(dependency));
    expect(real(path.join(serverNm(worktree), '@scope', 'core'))).toBe(
      real(path.join(worktree, 'packages', 'core')),
    );
  });

  it('node_modules 内とプロジェクト外の実体はワークスペースと判定しない', () => {
    const installed = path.join(main, 'node_modules', '.pnpm', 'installed');
    const external = path.join(base, 'external');
    for (const target of [installed, external]) fs.mkdirSync(target, { recursive: true });
    // 対応先が存在しても node_modules 内実体を worktree へ向けない。
    fs.mkdirSync(path.join(worktree, 'node_modules', '.pnpm', 'installed'), { recursive: true });
    const resolve = workspaceResolver(main, worktree);
    for (const [name, target] of [
      ['installed', installed],
      ['external', external],
    ]) {
      const entry = path.join(serverNm(main), '@scope', name);
      fs.symlinkSync(target, entry, 'junction');
      expect(resolve(entry)).toBeNull();
    }
    expect(resolve(path.join(serverNm(main), '@scope', 'core'))).toBe(
      path.join(worktree, 'packages', 'core'),
    );
    expect(resolve(path.join(serverNm(main), 'zod'))).toBeNull();
    removeTree(path.join(worktree, 'packages', 'core'));
    expect(resolve(path.join(serverNm(main), '@scope', 'core'))).toBeNull();
  });

  it('パッケージ配下の実インストールは再同期でも保持する', () => {
    const nm = serverNm(worktree);
    fs.mkdirSync(path.join(nm, '.bin'), { recursive: true });
    fs.writeFileSync(path.join(nm, 'local.txt'), 'local');
    expect(packagesNeedRelink(main, worktree)).toBe(false);
    expect(linkNodeModules(main, worktree)).not.toContain('apps/server');
    expect(fs.readFileSync(path.join(nm, 'local.txt'), 'utf8')).toBe('local');
    expect(fs.existsSync(path.join(nm, '.rapitas-linked-root'))).toBe(false);
  });
});

describe('removal leaves main intact', () => {
  it('unlinkRootEntries drops the links and the empty scope, not main', () => {
    linkNodeModules(main, worktree);
    expect(discoverInstalledDirs(main)).toContain('apps/server');

    expect(unlinkRootEntries(serverNm(worktree))).toBe(true);

    expect(fs.existsSync(path.join(serverNm(main), 'zod'))).toBe(true);
    expect(fs.existsSync(path.join(main, 'packages', 'core', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, 'packages', 'core', 'index.ts'))).toBe(true);
    expect(fs.existsSync(serverNm(worktree))).toBe(false);
  });
});
