#!/usr/bin/env node
/**
 * browser-e2e/run
 *
 * Drives the real, production-built Next.js frontend in a real Chromium
 * against a real isolated backend (throwaway SQLite, own ports) through the
 * critical flows in scenario-*.cjs, and fails unless every one of them ran
 * and passed (#1410). Never touches ports 3000/3001.
 *
 * Lives at the repo root so `node --test "scripts/**\/*.test.cjs"` runs its
 * unit tests; Playwright is resolved from rapitas-backend, which owns the
 * dependency. Uses playwright-core (not playwright): its browser revision is
 * the one `playwright-core install` fetches and the local cache holds.
 *
 * Usage: node scripts/browser-e2e/run.cjs [--no-build]
 * Env:   BROWSER_E2E_BACKEND_PORT (3221), BROWSER_E2E_FRONTEND_PORT (3220),
 *        BROWSER_E2E_ARTIFACTS (screenshots + logs), BROWSER_E2E_SABOTAGE
 *        (a key of lib.SABOTAGES — red-proof only, never in CI).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const lib = require('./lib.cjs');
const proc = require('./processes.cjs');
const { createApi, loadStrings, prepareContext } = require('./fixtures.cjs');

const SCENARIOS = [
  require('./scenario-task-edit.cjs'),
  require('./scenario-stop-failure.cjs'),
  require('./scenario-failed-save.cjs'),
];
const SCENARIO_TIMEOUT_MS = 120_000;

function log(msg) {
  console.log(`[browser-e2e] ${msg}`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runScenario(scenario, env) {
  const started = Date.now();
  const checker = lib.createChecker();
  const context = await env.browser.newContext({ locale: 'ja-JP', viewport: { width: 1400, height: 900 } });
  await prepareContext(context, { reservedHits: env.reservedHits, sabotage: env.sabotage });
  const page = await context.newPage();
  page.on('pageerror', (err) => log(`  [${scenario.name}] page error: ${err.message}`));
  try {
    await withTimeout(
      scenario.run({ ...env.shared, page, check: checker.check }),
      SCENARIO_TIMEOUT_MS,
      scenario.name,
    );
    return { name: scenario.name, status: 'passed', assertions: checker.count(), ms: Date.now() - started };
  } catch (err) {
    const shot = path.join(env.artifacts, `${scenario.name}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return {
      name: scenario.name,
      status: 'failed',
      assertions: checker.count(),
      ms: Date.now() - started,
      error: err.message.split('\n')[0],
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const started = Date.now();
  const backendPort = lib.parsePort(process.env.BROWSER_E2E_BACKEND_PORT, 3221);
  const frontendPort = lib.parsePort(process.env.BROWSER_E2E_FRONTEND_PORT, 3220);
  lib.assertSafePorts({ backendPort, frontendPort });
  const sabotage = lib.parseSabotage(process.env.BROWSER_E2E_SABOTAGE);
  const skipBuild = process.argv.includes('--no-build');
  const apiBase = `http://127.0.0.1:${backendPort}`;
  const frontendBase = `http://127.0.0.1:${frontendPort}`;
  const artifacts =
    process.env.BROWSER_E2E_ARTIFACTS || path.join(os.tmpdir(), 'rapitas-browser-e2e-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  if (sabotage) log(`SABOTAGE ACTIVE: ${sabotage} — ${lib.SABOTAGES[sabotage]}`);

  for (const port of [backendPort, frontendPort]) {
    if (!(await proc.isPortFree(port))) throw new Error(`port ${port} is already in use`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rapitas-browser-e2e-'));
  const results = [];
  const reservedHits = [];
  let backend = null;
  let frontend = null;
  let browser = null;
  let failure = null;
  try {
    const databaseUrl = `file:${path.join(tmp, 'browser-e2e.db').replace(/\\/g, '/')}`;
    backend = proc.startBackend({ port: backendPort, databaseUrl, corsOrigin: frontendBase });

    if (skipBuild) {
      log('--no-build: serving the existing .next (reserved-port guard still applies)');
    } else {
      log(`building frontend with NEXT_PUBLIC_API_BASE_URL=${apiBase} ...`);
      const build = proc.buildFrontend({ apiBaseUrl: apiBase });
      if (!build.ok) throw new Error(`next build failed after ${build.ms}ms\n${build.output}`);
      log(`frontend built in ${(build.ms / 1000).toFixed(0)}s`);
    }

    const health = await proc.waitForBackend(backendPort, 90_000);
    if (!health.ok) throw new Error(`backend never became ready\n${backend.log.read()}`);
    log(`backend ready in ${health.elapsedMs}ms`);

    frontend = proc.startFrontend({ port: frontendPort });
    const fe = await proc.waitForFrontend(frontendPort, 90_000);
    if (!fe.ok) throw new Error(`frontend never served / \n${frontend.log.read()}`);
    log(`frontend serving in ${fe.elapsedMs}ms`);

    const api = createApi(apiBase);
    const category = await api.post('/categories', { name: 'Browser E2E' });
    const theme = await api.post('/themes', {
      name: 'Browser E2E theme',
      categoryId: category.id,
      workingDirectory: tmp,
      isDevelopment: true,
    });

    const backendRequire = createRequire(path.join(proc.ROOT, 'rapitas-backend', 'package.json'));
    const { chromium } = backendRequire('playwright-core');
    browser = await chromium.launch();
    log(`chromium ${browser.version()} launched`);

    const shared = { api, apiBase, frontendBase, s: loadStrings(), sabotage, themeId: theme.id };
    for (const scenario of SCENARIOS) {
      const r = await runScenario(scenario, { browser, shared, reservedHits, sabotage, artifacts });
      log(`${r.status === 'passed' ? 'PASS' : 'FAIL'} ${r.name} (${r.assertions} assertions, ${r.ms}ms)${r.error ? ` — ${r.error}` : ''}`);
      results.push(r);
    }
  } catch (err) {
    failure = err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await proc.killTree(frontend);
    await proc.killTree(backend);
    for (const h of [backend, frontend]) {
      if (h) fs.writeFileSync(path.join(artifacts, `${h.name}.log`), h.log.read());
    }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }

  const verdict = lib.evaluateRun({
    expected: SCENARIOS.map((x) => x.name),
    results,
    browserLaunched: browser !== null,
    reservedHits,
  });
  if (failure) verdict.problems.unshift(`runner error: ${failure.message.split('\n')[0]}`);
  verdict.ok = verdict.ok && !failure;
  const summary = lib.renderSummary({
    results,
    verdict,
    meta: {
      duration: `${((Date.now() - started) / 1000).toFixed(0)}s`,
      backend: apiBase,
      frontend: `${frontendBase} (${skipBuild ? 'existing build' : 'fresh next build'})`,
      ...(sabotage ? { sabotage } : {}),
    },
  });
  if (failure) console.error(failure.message);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return verdict.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`[browser-e2e] ${err.stack || err.message}`);
    process.exitCode = 1;
  },
);
