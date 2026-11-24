/**
 * ルート node_modules を実ディレクトリとし、共有依存をエントリ単位で同期する。
 * pnpm のタスク状態は worktree に置き、解除時は共有先をたどらない。
 * インストールやリンク実行の判断は node-modules-link 側が担当する。
 */
import * as fs from 'node:fs';
import { basename, join } from 'node:path';
import { createLogger } from '../../../../../config/logger';

const logger = createLogger('git-operations/node-modules-root-entries');
export const ROOT_MARKER = '.rapitas-linked-root';

/** 不在だけを許容し、アクセス拒否を不在として扱わない。 */
function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** リンクだけを解除する。Windows の junction は非再帰 rmdir へフォールバックする。 */
export function removeLink(link: string): boolean {
  for (const remove of [fs.unlinkSync, fs.rmdirSync]) {
    try {
      remove(link);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    }
  }
  logger.warn({ link }, '[nodeModulesLink] リンクを解除できませんでした');
  return false;
}

/** node_modules の実ディレクトリと通常ファイルのマーカーだけを認識する。 */
export function isManagedRoot(nodeModules: string): boolean {
  try {
    return (
      basename(nodeModules) === 'node_modules' &&
      fs.lstatSync(nodeModules).isDirectory() &&
      fs.lstatSync(join(nodeModules, ROOT_MARKER)).isFile()
    );
  } catch {
    return false;
  }
}

/** 管理記録にある直下のコピー名。旧形式・不正な記録では所有を推測しない。 */
export function managedRootCopies(nodeModules: string): string[] {
  if (!isManagedRoot(nodeModules)) return [];
  try {
    const record = JSON.parse(fs.readFileSync(join(nodeModules, ROOT_MARKER), 'utf8'));
    if (record.version !== 1 || !Array.isArray(record.files)) return [];
    return record.files.filter(
      (name: unknown): name is string =>
        typeof name === 'string' &&
        name.length > 0 &&
        !['.', '..', ROOT_MARKER].includes(name) &&
        !/[\\/:]/.test(name),
    );
  } catch {
    return [];
  }
}

/** コピー前にも記録し、中断後の再同期で所有を失わないようにする。 */
function saveCopies(root: string, files: Set<string>): void {
  fs.writeFileSync(join(root, ROOT_MARKER), JSON.stringify({ version: 1, files: [...files] }));
}

/** サイズと更新時刻を比較し、コピーに変更が必要な場合だけ書き込む。 */
function syncFile(from: string, to: string, src: fs.Stats): void {
  const have = lstatOrNull(to);
  if (have?.isFile() && have.size === src.size && have.mtimeMs >= src.mtimeMs) return;
  fs.copyFileSync(from, to);
}

/**
 * pnpm 12 が再帰・filter 実行のたびに書く状態ディレクトリ。worktree ごとに持つ。
 *
 * NOTE: メインに残っていた .pnpm-task-run-state-v1 までリンクすると、pnpm は
 * 状態ディレクトリがリンクだとして同じ ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH で
 * 拒否する（TempoRaid 1420、2026-11-24）。リンクしなければ、既存のリンクは
 * 下の余剰エントリの掃除で外れ、pnpm が worktree 内に実ディレクトリを作る。
 */
export function isWorktreeLocal(name: string): boolean {
  return name.startsWith('.pnpm-task-run-state');
}

/**
 * ディレクトリは junction、ファイルはコピーとして同期する。
 * ローカルの実ディレクトリと未記録ファイルは、余剰エントリの掃除で消さない。
 */
export function linkRootEntries(target: string, link: string): boolean {
  let names: string[];
  const copies = new Set(managedRootCopies(link));
  try {
    const root = lstatOrNull(link);
    if (root && !root.isDirectory()) return false;
    names = fs.readdirSync(target).filter((name) => name !== ROOT_MARKER && !isWorktreeLocal(name));
    fs.mkdirSync(link, { recursive: true });
    saveCopies(link, copies);
  } catch (err) {
    logger.warn({ err, link, target }, '[nodeModulesLink] ルートを準備できませんでした');
    return false;
  }
  let clean = true;
  for (const name of names) {
    const from = join(target, name);
    const to = join(link, name);
    try {
      const src = fs.statSync(from);
      const have = lstatOrNull(to);
      if (src.isDirectory()) {
        if (have?.isSymbolicLink()) {
          if (fs.existsSync(to) && fs.realpathSync(to) === fs.realpathSync(from)) continue;
          if (!removeLink(to)) {
            clean = false;
            continue;
          }
        } else if (have) {
          continue;
        }
        try {
          fs.symlinkSync(from, to, 'junction');
        } catch (err) {
          // 同時作成でも、期待した共有先へのリンクであることを確認する。
          if (
            (err as NodeJS.ErrnoException).code !== 'EEXIST' ||
            !fs.lstatSync(to).isSymbolicLink() ||
            fs.realpathSync(to) !== fs.realpathSync(from)
          )
            throw err;
        }
      } else if (src.isFile()) {
        if (have && !have.isFile()) continue;
        // 同名でも、既存の未記録ファイルをコピー所有物へ昇格させない。
        if (have && !copies.has(name)) continue;
        copies.add(name);
        saveCopies(link, copies);
        syncFile(from, to, src);
      }
    } catch (err) {
      clean = false;
      logger.warn({ err, to }, '[nodeModulesLink] エントリを同期できませんでした');
    }
  }
  const wanted = new Set(names);
  try {
    for (const name of fs.readdirSync(link)) {
      if (wanted.has(name) || name === ROOT_MARKER) continue;
      const p = join(link, name);
      const st = lstatOrNull(p);
      if (st?.isSymbolicLink()) {
        if (!removeLink(p)) clean = false;
      } else if (st?.isFile() && copies.has(name)) {
        fs.unlinkSync(p);
        copies.delete(name);
      }
    }
    saveCopies(link, copies);
  } catch (err) {
    logger.warn({ err, link }, '[nodeModulesLink] 余剰エントリを同期できませんでした');
    return false;
  }
  return clean;
}

/**
 * 深さ制限なく lstat で走査し、リンクだけを解除する。実ファイルは削除しない。
 * 不在は成功、走査・解除失敗は記録して継続し、呼び出し元に削除不可を返す。
 */
export function detachLinksSafely(directory: string): boolean {
  const pending = [directory];
  let clean = true;
  while (pending.length > 0) {
    const p = pending.pop()!;
    try {
      const st = lstatOrNull(p);
      if (st?.isSymbolicLink()) {
        if (!removeLink(p)) clean = false;
      } else if (st?.isDirectory()) {
        for (const name of fs.readdirSync(p)) pending.push(join(p, name));
      }
    } catch (err) {
      clean = false;
      logger.warn({ err, path: p }, '[nodeModulesLink] リンクの安全解除を完了できませんでした');
    }
  }
  return clean;
}

/**
 * 全リンクの解除後、記録済みコピーとマーカーを解除する。
 * 失敗時はマーカーを残すため、再試行も管理下ルートとして残存リンクを調べる。
 */
export function unlinkRootEntries(nodeModules: string): boolean {
  if (!isManagedRoot(nodeModules)) return true;
  const copies = managedRootCopies(nodeModules);
  if (!detachLinksSafely(nodeModules)) return false;
  try {
    for (const name of copies) {
      const p = join(nodeModules, name);
      if (lstatOrNull(p)?.isFile()) fs.unlinkSync(p);
    }
    fs.unlinkSync(join(nodeModules, ROOT_MARKER));
  } catch (err) {
    logger.warn({ err, nodeModules }, '[nodeModulesLink] コピーの解除を完了できませんでした');
    return false;
  }
  try {
    fs.rmdirSync(nodeModules);
  } catch {
    // worktree 自身のファイル・キャッシュは残す。再帰削除はしない。
  }
  return true;
}

/** 依存リンクが一つ以上あり、すべてのリンク先が存在するときだけ利用可能。 */
export function managedRootIsUsable(nodeModules: string): boolean {
  let links = 0;
  try {
    for (const name of fs.readdirSync(nodeModules)) {
      const p = join(nodeModules, name);
      if (!lstatOrNull(p)?.isSymbolicLink()) continue;
      if (!fs.existsSync(p)) return false;
      links++;
    }
  } catch {
    return false;
  }
  return links > 0;
}
