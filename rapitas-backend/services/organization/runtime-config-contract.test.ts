/**
 * runtime-config-contract.test
 *
 * 実測した事故を再現で固定する（2026-10-12、ContextFlow task #1212）。
 * エージェントが書いた設定は
 *   {"start":"pnpm dev -p 3210","url":"http://localhost:3210","port":3210}
 * で、既存の parseRuntimeConfig はこれを合格させる。結果、ハーネスが割り当てた
 * ポートでアプリを起動できず、Next.js が既定の 3000 を試し、rapitas フロント
 * エンドに塞がれていたため自動インクリメントして `[::]:3001` を掴んだ。
 * バックエンドと同じポートで、localhost→::1 のクライアントは生成アプリに届く。
 */
import { describe, expect, test } from 'bun:test';
import {
  checkRuntimeConfigContract,
  RESERVED_PORTS,
  REQUIRED_HOST,
  PORT_PLACEHOLDER,
} from './runtime-config-contract';

const codes = (raw: { start?: unknown; url?: unknown }) =>
  checkRuntimeConfigContract(raw).map((v) => v.code);

describe('checkRuntimeConfigContract', () => {
  test('rapitas 自身の設定の形は合格する', () => {
    expect(
      codes({
        start: `cd rapitas-frontend && npm run dev:runtime -- -p ${PORT_PLACEHOLDER}`,
        url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`,
      }),
    ).toEqual([]);
  });

  test('#1212 が書いた設定をそのまま落とす（この事故の再現）', () => {
    const got = codes({ start: 'pnpm dev -p 3210', url: 'http://localhost:3210' });
    expect(got).toContain('start_missing_port_placeholder');
    expect(got).toContain('url_missing_port_placeholder');
    expect(got).toContain('url_host_not_loopback');
  });

  test('start のポート固定を検出する', () => {
    expect(
      codes({ start: 'pnpm dev -p 4000', url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}` }),
    ).toEqual(['start_missing_port_placeholder']);
  });

  test('url のポート固定を検出する', () => {
    expect(
      codes({ start: `pnpm dev -- -p ${PORT_PLACEHOLDER}`, url: `http://${REQUIRED_HOST}:4000` }),
    ).toEqual(['url_missing_port_placeholder']);
  });

  for (const host of ['localhost', '0.0.0.0', '[::1]']) {
    test(`ホスト ${host} を拒否する（IPv6 側での横取りを防ぐ）`, () => {
      const got = codes({
        start: `pnpm dev -- -p ${PORT_PLACEHOLDER}`,
        url: `http://${host}:${PORT_PLACEHOLDER}`,
      });
      expect(got).toContain('url_host_not_loopback');
    });
  }

  for (const port of RESERVED_PORTS) {
    test(`予約ポート ${port} を start で使えない`, () => {
      expect(
        codes({
          start: `pnpm dev -- -p ${port}`,
          url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`,
        }),
      ).toContain('reserved_port');
    });

    test(`予約ポート ${port} を url で使えない`, () => {
      expect(
        codes({
          start: `pnpm dev -- -p ${PORT_PLACEHOLDER}`,
          url: `http://${REQUIRED_HOST}:${port}`,
        }),
      ).toContain('reserved_port');
    });
  }

  test('127.0.0.1 の数字はポートと誤認しない', () => {
    // ホスト部の 127 や 0 を literal port として拾うと、正しい設定が落ちる。
    expect(
      codes({
        start: `pnpm dev -- -p ${PORT_PLACEHOLDER}`,
        url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`,
      }),
    ).toEqual([]);
  });

  test('url が無い・文字列でない場合もプレースホルダ欠落として報告する', () => {
    expect(codes({ start: undefined, url: 42 })).toEqual([
      'start_missing_port_placeholder',
      'url_missing_port_placeholder',
    ]);
  });

  test('違反メッセージは理由と対処を含む（エージェントが読んで直せる形）', () => {
    const v = checkRuntimeConfigContract({ start: 'pnpm dev', url: 'http://localhost:3001' });
    expect(v.find((x) => x.code === 'url_host_not_loopback')?.message).toContain(REQUIRED_HOST);
    expect(v.find((x) => x.code === 'reserved_port')?.message).toContain('3001');
  });
});
