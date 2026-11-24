/** ルートの共有依存の同期と、失敗時にもリンク先を守る解除処理。 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
  isManagedRoot,
  linkRootEntries,
  ROOT_MARKER,
  unlinkRootEntries,
} from './node-modules-root-entries';

let base: string;
let source: string;
let root: string;

/** 失敗したテストの後も junction をたどらず一時領域のみ回収する。 */
function removeFixture(p: string): void {
  const stat = fs.lstatSync(p);
  if (stat.isSymbolicLink()) {
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
  } else if (stat.isDirectory()) {
    for (const name of fs.readdirSync(p)) removeFixture(join(p, name));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}

beforeEach(() => {
  base = fs.mkdtempSync(join(os.tmpdir(), 'root-entries-'));
  source = join(base, 'main', 'node_modules');
  root = join(base, 'worktree', 'node_modules');
  for (const name of ['.pnpm', '.bin', '@scope', 'pkg']) {
    fs.mkdirSync(join(source, name), { recursive: true });
    fs.writeFileSync(join(source, name, 'keep'), name);
  }
  fs.writeFileSync(join(source, '.modules.yaml'), 'layoutVersion: 5\n');
});

afterEach(() => {
  mock.restore();
  removeFixture(base);
});

describe('ルートエントリの同期', () => {
  it('同名の未記録ファイルをコピーへ昇格させず削除から保護する', () => {
    expect(linkRootEntries(source, root)).toBe(true);
    fs.writeFileSync(join(root, 'collision.txt'), '独自');
    fs.writeFileSync(join(source, 'collision.txt'), '原本');
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.readFileSync(join(root, 'collision.txt'), 'utf8')).toBe('独自');
    fs.unlinkSync(join(source, 'collision.txt'));
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.readFileSync(join(root, 'collision.txt'), 'utf8')).toBe('独自');
    expect(unlinkRootEntries(root)).toBe(true);
    expect(fs.readFileSync(join(root, 'collision.txt'), 'utf8')).toBe('独自');
  });

  it('メインから消えたコピーだけを削除し、ローカルファイルを保持する', () => {
    expect(linkRootEntries(source, root)).toBe(true);
    fs.writeFileSync(join(root, 'local.txt'), '作業データ');
    fs.unlinkSync(join(source, '.modules.yaml'));
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.existsSync(join(root, '.modules.yaml'))).toBe(false);
    expect(fs.readFileSync(join(root, 'local.txt'), 'utf8')).toBe('作業データ');
  });

  it('サイズまたは更新時刻の変化をコピーへ反映する', () => {
    expect(linkRootEntries(source, root)).toBe(true);
    fs.writeFileSync(join(source, '.modules.yaml'), 'layoutVersion: 123\n');
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.readFileSync(join(root, '.modules.yaml'), 'utf8')).toBe('layoutVersion: 123\n');
    fs.writeFileSync(join(source, '.modules.yaml'), 'layoutVersion: 456\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(join(source, '.modules.yaml'), later, later);
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.readFileSync(join(root, '.modules.yaml'), 'utf8')).toBe('layoutVersion: 456\n');
  });

  it('別の実行が先にjunctionを作成したEEXIST競合を成功扱いにする', () => {
    const symlink = fs.symlinkSync;
    let raced = false;
    spyOn(fs, 'symlinkSync').mockImplementation((target, dest, type) => {
      if (!raced) {
        raced = true;
        symlink(target, dest, type);
        throw Object.assign(new Error('同時作成'), { code: 'EEXIST' });
      }
      return symlink(target, dest, type);
    });
    expect(linkRootEntries(source, root)).toBe(true);
    expect(raced).toBe(true);
    for (const name of ['.pnpm', '.bin', '@scope', 'pkg']) {
      expect(fs.realpathSync(join(root, name))).toBe(fs.realpathSync(join(source, name)));
    }
  });
});

describe('ルートエントリの安全解除', () => {
  it('解除失敗時はマーカーを保持し、再試行で残存junctionを解除する', () => {
    linkRootEntries(source, root);
    const blocked = join(root, 'pkg');
    const unlink = fs.unlinkSync;
    const rmdir = fs.rmdirSync;
    const busy = () => Object.assign(new Error('一時的なロック'), { code: 'EBUSY' });
    spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      if (p === blocked) throw busy();
      return unlink(p);
    });
    spyOn(fs, 'rmdirSync').mockImplementation((p, options) => {
      if (p === blocked) throw busy();
      return rmdir(p, options);
    });
    expect(unlinkRootEntries(root)).toBe(false);
    expect(fs.existsSync(join(root, ROOT_MARKER))).toBe(true);
    expect(fs.lstatSync(blocked).isSymbolicLink()).toBe(true);
    mock.restore();
    expect(unlinkRootEntries(root)).toBe(true);
    expect(fs.existsSync(root)).toBe(false);
    for (const name of ['.pnpm', '.bin', '@scope', 'pkg']) {
      expect(fs.readFileSync(join(source, name, 'keep'), 'utf8')).toBe(name);
    }
    expect(fs.readFileSync(join(source, '.modules.yaml'), 'utf8')).toBe('layoutVersion: 5\n');
  });

  it('ローカルキャッシュの深いリンクも解除し実データを保持する', () => {
    linkRootEntries(source, root);
    const cache = join(root, '.cache', 'a', 'b', 'c', 'd', 'e');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(join(cache, 'local.txt'), '残す');
    fs.symlinkSync(join(source, 'pkg'), join(cache, 'deep-link'), 'junction');
    expect(unlinkRootEntries(root)).toBe(true);
    expect(fs.existsSync(join(cache, 'deep-link'))).toBe(false);
    expect(fs.readFileSync(join(cache, 'local.txt'), 'utf8')).toBe('残す');
    expect(fs.readFileSync(join(source, 'pkg', 'keep'), 'utf8')).toBe('pkg');
  });

  it('管理対象外の実ファイルを解除処理で消さない', () => {
    linkRootEntries(source, root);
    fs.writeFileSync(join(root, 'local.txt'), '残す');
    expect(unlinkRootEntries(root)).toBe(true);
    expect(fs.readFileSync(join(root, 'local.txt'), 'utf8')).toBe('残す');
    expect(fs.existsSync(join(root, '.modules.yaml'))).toBe(false);
  });

  it('走査できない実ディレクトリは安全扱いせずマーカーを保持する', () => {
    linkRootEntries(source, root);
    const cache = join(root, '.cache');
    fs.mkdirSync(cache);
    const read = fs.readdirSync;
    spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, options: unknown) => {
      if (p === cache) throw Object.assign(new Error('アクセス拒否'), { code: 'EACCES' });
      return read(p, options as never);
    }) as typeof fs.readdirSync);
    expect(unlinkRootEntries(root)).toBe(false);
    expect(fs.existsSync(join(root, ROOT_MARKER))).toBe(true);
  });

  it('node_modules以外のマーカーを管理対象として扱わない', () => {
    const notes = join(base, 'notes');
    fs.mkdirSync(notes);
    fs.writeFileSync(join(notes, ROOT_MARKER), 'managed by rapitas node-modules-link\n');
    fs.writeFileSync(join(notes, 'work.txt'), '作業データ');
    expect(isManagedRoot(notes)).toBe(false);
    expect(unlinkRootEntries(notes)).toBe(true);
    expect(fs.readFileSync(join(notes, 'work.txt'), 'utf8')).toBe('作業データ');
  });
});

// 2026-11-24: TempoRaid のメインの node_modules には、メインで pnpm -r を
// 走らせたときの .pnpm-task-run-state-v1 があった。#1717 はこれも junction に
// したため、worktree の pnpm -r が同じ ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH で
// 拒否された（今度は状態ディレクトリそのものがリンクだった）。
describe('pnpm の状態ディレクトリは worktree ごとに持つ', () => {
  it('メインの .pnpm-task-run-state-* をリンクしない', () => {
    fs.mkdirSync(join(source, '.pnpm-task-run-state-v1'), { recursive: true });
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.existsSync(join(root, '.pnpm-task-run-state-v1'))).toBe(false);
    expect(fs.lstatSync(join(root, '.pnpm')).isSymbolicLink()).toBe(true);
  });

  it('既にリンクされた状態ディレクトリを外し、メイン側は残す', () => {
    fs.mkdirSync(join(source, '.pnpm-task-run-state-v1'), { recursive: true });
    fs.writeFileSync(join(source, '.pnpm-task-run-state-v1', 'state'), 'main');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(
      join(source, '.pnpm-task-run-state-v1'),
      join(root, '.pnpm-task-run-state-v1'),
      'junction',
    );
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.existsSync(join(root, '.pnpm-task-run-state-v1'))).toBe(false);
    expect(fs.readFileSync(join(source, '.pnpm-task-run-state-v1', 'state'), 'utf8')).toBe('main');
  });

  it('worktree が自分で作った状態ディレクトリは消さない', () => {
    expect(linkRootEntries(source, root)).toBe(true);
    fs.mkdirSync(join(root, '.pnpm-task-run-state-v1'));
    fs.writeFileSync(join(root, '.pnpm-task-run-state-v1', 'state'), 'local');
    expect(linkRootEntries(source, root)).toBe(true);
    expect(fs.readFileSync(join(root, '.pnpm-task-run-state-v1', 'state'), 'utf8')).toBe('local');
  });
});
