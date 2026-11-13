// @vitest-environment node
/**
 * frame-ancestors-config.test
 *
 * No app document may be framed (nav60 §3.3): every route served by Next
 * carries `frame-ancestors 'none'` and `X-Frame-Options: DENY`. The static
 * desktop export cannot use headers() — tauri.conf.json's CSP covers it, and
 * this also pins that the CSP still says frame-ancestors 'none'.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RAPITAS_RUNTIME_PREVIEW', 'false');
  vi.stubEnv('TAURI_BUILD', 'false');
  vi.stubEnv('PORT', '');
});
afterEach(() => vi.unstubAllEnvs());

test('every route refuses to be framed, with no allowance for self', async () => {
  const config = (await import('../../next.config')).default;
  const rules = await config.headers?.();
  expect(rules).toEqual([
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
  ]);
});

test('the desktop dev server (TAURI_BUILD under next dev) is covered too', async () => {
  vi.stubEnv('TAURI_BUILD', 'true');
  vi.stubEnv('NODE_ENV', 'development');
  const config = (await import('../../next.config')).default;
  expect(config.output).toBeUndefined();
  expect(await config.headers?.()).toHaveLength(1);
});

test('the static export defers to the Tauri CSP, which keeps frame-ancestors none', async () => {
  vi.stubEnv('TAURI_BUILD', 'true');
  vi.stubEnv('NODE_ENV', 'production');
  const config = (await import('../../next.config')).default;
  expect(config.output).toBe('export');
  expect(config.headers).toBeUndefined();
  const tauriConf = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../rapitas-desktop/src-tauri/tauri.conf.json'),
      'utf8',
    ),
  );
  expect(tauriConf.app.security.csp).toContain("frame-ancestors 'none'");
});
