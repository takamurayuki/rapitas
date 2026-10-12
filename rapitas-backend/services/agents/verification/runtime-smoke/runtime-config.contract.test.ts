/**
 * runtime-config.contract.test
 *
 * parseRuntimeConfig が起動契約を強制することを固定する。
 *
 * 実測 2026-10-12 (ContextFlow task #1212): エージェントが登録した設定は
 *   {"start":"pnpm dev -p 3210","url":"http://localhost:3210","port":3210}
 * で、`{port}` は任意の置換として扱われていたため**合格**した。結果、
 * ハーネスが割り当てたポートでアプリを起動できず、Next.js が既定の 3000 を
 * 試し、rapitas フロントエンドに塞がれていたため自動インクリメントして
 * `[::]:3001` を掴んだ。バックエンドと同じポートで、localhost→::1 の
 * クライアントは生成アプリに届く（2026-07-08 と 2026-10-10 と同じ形）。
 *
 * 設定を受け取る時点で落とさないと、同じ事故が起票のたびに再発する。
 */
import { describe, expect, test } from 'bun:test';
import { parseRuntimeConfig } from './runtime-config';
import { PORT_PLACEHOLDER, REQUIRED_HOST } from '../../../organization/runtime-config-contract';

const good = {
  start: `pnpm dev -- -p ${PORT_PLACEHOLDER}`,
  url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`,
};

describe('parseRuntimeConfig — launch contract', () => {
  test('契約を満たす設定は従来どおり通る', () => {
    const { config, error } = parseRuntimeConfig(JSON.stringify(good));
    expect(error).toBeUndefined();
    expect(config?.start).toBe(good.start);
  });

  test('#1212 の設定を拒否する（この事故の再現）', () => {
    const { config, error } = parseRuntimeConfig(
      JSON.stringify({ start: 'pnpm dev -p 3210', url: 'http://localhost:3210', port: 3210 }),
    );
    expect(config).toBeUndefined();
    expect(error).toBeDefined();
  });

  test('エラーメッセージが直し方を示す', () => {
    const { error } = parseRuntimeConfig(
      JSON.stringify({ start: 'pnpm dev -p 3210', url: 'http://localhost:3210' }),
    );
    expect(error).toContain(PORT_PLACEHOLDER);
  });

  test('start のポート固定だけでも拒否する', () => {
    const { error } = parseRuntimeConfig(JSON.stringify({ ...good, start: 'pnpm dev -- -p 4000' }));
    expect(error).toBeDefined();
  });

  // 実測 2026-10-12: tripla / trendline / fusen の3テーマが
  // `http://localhost:{port}` で稼働中。拒否すると問題のないプロジェクトの
  // 起動確認まで止まるため、127.0.0.1 へ正規化して受け入れる。
  test('url のホストが localhost なら 127.0.0.1 に正規化して受け入れる', () => {
    const { config, error } = parseRuntimeConfig(
      JSON.stringify({ ...good, url: `http://localhost:${PORT_PLACEHOLDER}` }),
    );
    expect(error).toBeUndefined();
    expect(config?.url).toBe(`http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`);
  });

  test('ワイルドカードホストは拒否する', () => {
    const { error } = parseRuntimeConfig(
      JSON.stringify({ ...good, url: `http://0.0.0.0:${PORT_PLACEHOLDER}` }),
    );
    expect(error).toContain(REQUIRED_HOST);
  });

  for (const theme of [
    { name: 'tripla', start: 'flutter run -d web-server --web-port {port} --release' },
    { name: 'trendline', start: 'node scripts/dev-all.mjs {port}' },
    { name: 'fusen', start: 'pnpm run dev -- --port {port} --strictPort' },
  ]) {
    test(`稼働中テーマ ${theme.name} の実設定が通る`, () => {
      const { config, error } = parseRuntimeConfig(
        JSON.stringify({ start: theme.start, url: `http://localhost:${PORT_PLACEHOLDER}` }),
      );
      expect(error).toBeUndefined();
      expect(config?.url).toBe(`http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`);
    });
  }

  test('予約ポートを含む設定を拒否する', () => {
    const { error } = parseRuntimeConfig(JSON.stringify({ ...good, start: `pnpm dev -- -p 3001` }));
    expect(error).toContain('3001');
  });

  test('既存の形式エラーは契約チェックより先に報告される', () => {
    // JSON 不正や start 欠落は、契約の文言より具体的で有用。
    expect(parseRuntimeConfig('{').error).toContain('invalid JSON');
    expect(parseRuntimeConfig(JSON.stringify({ url: good.url })).error).toContain('"start"');
  });

  test('rapitas 自身の実設定が通る（既存プロジェクトを壊さないこと）', () => {
    const own = {
      start: `cd rapitas-frontend && npm run dev:runtime -- -p ${PORT_PLACEHOLDER}`,
      url: `http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}`,
      healthPath: '/',
      readyTimeoutMs: 120000,
      checkPaths: ['/'],
      readySelector: '[data-app-ready="true"]',
      readinessTimeoutMs: 25000,
    };
    const { config, error } = parseRuntimeConfig(JSON.stringify(own));
    expect(error).toBeUndefined();
    expect(config?.readySelector).toBe('[data-app-ready="true"]');
  });
});
