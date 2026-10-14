/**
 * backend-process-identity.test
 *
 * 実測した事故を再現で固定する（2026-10-12、ContextFlow task #1212）。
 *
 * killProcessTreeSafely の「バックエンド保護」は**ポート基準**だった:
 * 3001 を LISTEN しているプロセスは誰であれ kill を拒否する。そのため
 * 生成プロジェクトの dev サーバーが Next.js の自動インクリメントで
 * `[::]:3001` を掴むと、系は自分では排除できなくなり、ゴースト LISTEN が
 * 残り続ける（2026-10-10 の2時間停止と同じ形）。
 *
 * さらに Windows 側の判定は netstat 出力に対する**部分文字列一致**で、
 * pid 275 が "27512" を含む行にマッチして無関係なプロセスを保護し得た。
 *
 * 保護すべきなのは「3001 を使っているもの」ではなく「バックエンド自身」——
 * つまり自プロセスとその祖先だけ。
 */
import { describe, expect, test } from 'bun:test';
import { parseListenerPids, ancestorPids, isProtectedBackendPid } from './backend-process-identity';

/** Real `netstat -aon` shape, including the loose-match trap. */
const NETSTAT = [
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       7992',
  '  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       27260',
  '  TCP    [::]:3001              [::]:0                 LISTENING       27512',
  '  TCP    127.0.0.1:30011        0.0.0.0:0              LISTENING       4242',
  '  TCP    127.0.0.1:3001         127.0.0.1:51000        ESTABLISHED     8888',
].join('\r\n');

describe('parseListenerPids', () => {
  test('LISTEN 行の PID 列だけを返す', () => {
    expect(parseListenerPids(NETSTAT, 3001).sort((a, b) => a - b)).toEqual([27260, 27512]);
  });

  test('ポート 30011 を 3001 と混同しない', () => {
    expect(parseListenerPids(NETSTAT, 3001)).not.toContain(4242);
  });

  test('ESTABLISHED は LISTEN ではない', () => {
    expect(parseListenerPids(NETSTAT, 3001)).not.toContain(8888);
  });

  test('部分文字列一致にならない（pid 275 は 27512 ではない）', () => {
    // 旧実装は netstat 出力全体に対する includes(String(pid)) だった。
    expect(parseListenerPids(NETSTAT, 3001)).not.toContain(275);
  });

  test('別ポートを問い合わせれば別の結果になる', () => {
    expect(parseListenerPids(NETSTAT, 3000)).toEqual([7992]);
  });

  test('空・壊れた出力でも落ちず空配列を返す', () => {
    expect(parseListenerPids('', 3001)).toEqual([]);
    expect(parseListenerPids('garbage', 3001)).toEqual([]);
  });
});

describe('ancestorPids', () => {
  // backend-wrapper.ps1 → bun server-entry.ts という実際の親子関係を模す。
  const parents = new Map([
    [27260, 20080],
    [20080, 9000],
    [9000, 0],
  ]);
  const parentOf = (pid: number) => parents.get(pid);

  test('自分自身と祖先を列挙する', () => {
    expect([...ancestorPids(27260, parentOf)].sort((a, b) => a - b)).toEqual([9000, 20080, 27260]);
  });

  test('親が不明な時点で止まる', () => {
    expect([...ancestorPids(99999, parentOf)]).toEqual([99999]);
  });

  test('親リンクの循環で無限ループしない', () => {
    const cyclic = new Map([
      [1, 2],
      [2, 1],
    ]);
    expect([...ancestorPids(1, (p) => cyclic.get(p))].sort()).toEqual([1, 2]);
  });
});

describe('isProtectedBackendPid', () => {
  const parents = new Map([
    [27260, 20080],
    [20080, 9000],
  ]);
  const opts = { selfPid: 27260, parentOf: (p: number) => parents.get(p) };

  test('バックエンド自身は保護する', () => {
    expect(isProtectedBackendPid(27260, opts)).toBe(true);
  });

  test('バックエンドの祖先（ラッパー）も保護する', () => {
    // backend-wrapper.ps1 を殺すとバックエンドも落ちる。
    expect(isProtectedBackendPid(20080, opts)).toBe(true);
    expect(isProtectedBackendPid(9000, opts)).toBe(true);
  });

  test('3001 を掴んだ侵入者は保護しない（この事故の核心）', () => {
    // pid 27512 は contextflow worktree の Next.js dev サーバー。
    // ポートを持っていることは保護の理由にならない。
    expect(isProtectedBackendPid(27512, opts)).toBe(false);
  });

  test('無関係なプロセスも当然保護しない', () => {
    expect(isProtectedBackendPid(4242, opts)).toBe(false);
  });
});
