/**
 * browser-e2e/processes
 *
 * Spawns, waits for and tears down the isolated backend and the built
 * Next.js frontend the Browser E2E drives. Kills only the process trees it
 * started itself — never anything found already listening on a port.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { commonAncestor, createTailBuffer, pollUntil } = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.join(ROOT, 'rapitas-backend');
const FRONTEND_DIR = path.join(ROOT, 'rapitas-frontend');
const NEXT_BIN = path.join(FRONTEND_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const IS_WIN = process.platform === 'win32';

/**
 * Fail early when something already listens on a port, so the run can never
 * end up testing a server it did not start.
 *
 * @param {number} port - Port to probe / 確認するポート
 * @returns {Promise<boolean>} true when nothing accepts a connection / 空いていれば true
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(true));
  });
}

function startChild(name, cmd, args, opts) {
  const log = createTailBuffer(20_000);
  // detached on POSIX gives the child its own process group so killTree can
  // signal the whole group (bun spawns workers; next start forks).
  const child = spawn(cmd, args, { ...opts, detached: !IS_WIN, windowsHide: true });
  child.stdout.on('data', (d) => log.append(d.toString()));
  child.stderr.on('data', (d) => log.append(d.toString()));
  child.on('error', (err) => log.append(`\n[${name}] spawn error: ${err.message}\n`));
  return { name, child, log };
}

/**
 * Start the backend on a throwaway SQLite file. The schema is created by the
 * backend itself at boot (config/desktop-sqlite.ts) — no prisma db push.
 *
 * @param {{port: number, databaseUrl: string, corsOrigin: string}} opts - Port, DB and allowed origin / 起動設定
 * @returns {{name: string, child: import('node:child_process').ChildProcess, log: {read: () => string}}}
 */
function startBackend({ port, databaseUrl, corsOrigin }) {
  return startChild('backend', 'bun', ['run', 'index.ts'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      RAPITAS_EVAL_MODE: 'true',
      // The isolated frontend's origin, through the existing CORS_ORIGIN knob
      // (config/cors-options.ts) — production defaults stay untouched.
      CORS_ORIGIN: corsOrigin,
    },
  });
}

/**
 * Wait until /health reports healthy AND ready (warm-up done; writing before
 * that races the warm-up on SQLite).
 *
 * @param {number} port - Backend port / バックエンドポート
 * @param {number} timeoutMs - Deadline / 待機上限
 * @returns {Promise<{ok: boolean, elapsedMs: number}>} Outcome / 結果
 */
async function waitForBackend(port, timeoutMs) {
  return pollUntil(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return false;
      const body = await res.json();
      return body.status === 'healthy' && body.ready === true;
    },
    { timeoutMs, intervalMs: 500 },
  );
}

/**
 * Turbopack root for this checkout: in a worktree node_modules is a junction
 * into the main checkout, outside the default root, and the build fails.
 *
 * @returns {string|undefined} Root override, or undefined when not needed / ルート上書き値
 */
function turbopackRoot() {
  const real = fs.realpathSync(path.join(FRONTEND_DIR, 'node_modules'));
  const ancestor = commonAncestor(ROOT, real);
  return ancestor === ROOT ? undefined : ancestor;
}

/**
 * Production-build the frontend with the isolated backend's URL inlined.
 * NEXT_PUBLIC_* is baked in at build time, which is why the build belongs to
 * the run and is not reused from elsewhere.
 *
 * @param {{apiBaseUrl: string}} opts - API base the bundle must call / 呼び出し先API
 * @returns {{ok: boolean, ms: number, output: string}} Build outcome / ビルド結果
 */
function buildFrontend({ apiBaseUrl }) {
  const start = Date.now();
  const env = { ...process.env, NEXT_PUBLIC_API_BASE_URL: apiBaseUrl, NEXT_TELEMETRY_DISABLED: '1' };
  const root = turbopackRoot();
  if (root) env.RAPITAS_TURBOPACK_ROOT = root;
  // The two generators are what `pnpm run build`'s prebuild runs; invoked
  // directly so no package manager runs inside a worktree.
  const steps = [
    [path.join(FRONTEND_DIR, 'scripts', 'generate-messages.mjs')],
    [path.join(FRONTEND_DIR, 'scripts', 'generate-agents-panels.mjs')],
    [NEXT_BIN, 'build'],
  ];
  let output = '';
  for (const args of steps) {
    const r = spawnSync(process.execPath, args, {
      cwd: FRONTEND_DIR,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0) return { ok: false, ms: Date.now() - start, output: output.slice(-20_000) };
  }
  return { ok: true, ms: Date.now() - start, output: output.slice(-4000) };
}

/**
 * Serve the production build.
 *
 * @param {{port: number}} opts - Frontend port / フロントエンドポート
 * @returns {{name: string, child: import('node:child_process').ChildProcess, log: {read: () => string}}}
 */
function startFrontend({ port }) {
  return startChild(
    'frontend',
    process.execPath,
    [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: FRONTEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
  );
}

/**
 * Wait until the frontend serves a page.
 *
 * @param {number} port - Frontend port / フロントエンドポート
 * @param {number} timeoutMs - Deadline / 待機上限
 * @returns {Promise<{ok: boolean, elapsedMs: number}>} Outcome / 結果
 */
async function waitForFrontend(port, timeoutMs) {
  return pollUntil(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    },
    { timeoutMs, intervalMs: 1000 },
  );
}

/**
 * Kill a process tree this runner started, and wait for it to exit.
 *
 * @param {{child: import('node:child_process').ChildProcess}|null} handle - Spawned handle / 起動ハンドル
 * @returns {Promise<void>}
 */
async function killTree(handle) {
  const child = handle?.child;
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise((r) => child.once('exit', r));
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Group already gone.
    }
    const force = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already exited.
      }
    }, 5000);
    force.unref();
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
}

module.exports = {
  ROOT,
  FRONTEND_DIR,
  isPortFree,
  startBackend,
  waitForBackend,
  buildFrontend,
  startFrontend,
  waitForFrontend,
  killTree,
};
