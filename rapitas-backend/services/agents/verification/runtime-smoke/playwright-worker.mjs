#!/usr/bin/env node
/**
 * playwright-worker
 *
 * Standalone Node.js script that drives playwright-core against a real
 * system browser (Edge/Chrome). Exists because Bun — the runtime the rest of
 * rapitas-backend runs under — cannot complete Playwright's CDP handshake:
 * confirmed live, both chromium.launch() (pipe transport) and
 * chromium.connectOverCDP() (WebSocket transport) hang until timeout under
 * Bun 1.3.13, while the identical call succeeds in well under a second under
 * plain Node.js. This script is spawned via the system `node` binary (never
 * `bun`) by playwright-worker-client.ts and driven over a line-delimited
 * JSON protocol on stdin/stdout, so no Playwright object ever needs to cross
 * into the Bun process.
 *
 * Protocol: each stdin line is {id, cmd, args}; each stdout line is
 * {id, ok:true, result} or {id, ok:false, error}. Nothing else may ever be
 * written to stdout — it would corrupt the protocol stream (that's why every
 * failure path below reports itself as a normal {ok:false} response instead
 * of throwing to the top level / logging to stdout).
 */
'use strict';

let browser = null;
let context = null;
/** The single "current" page — every command here is used sequentially by one caller, never concurrently. */
let page = null;
let pageEvents = null;

function resetPageEvents() {
  pageEvents = { pageErrors: [], consoleErrors: [], serverErrors: [] };
}

function attachListeners(p) {
  p.on('pageerror', (err) => pageEvents.pageErrors.push(String(err.message).slice(0, 300)));
  p.on('console', (msg) => {
    if (msg.type() === 'error') pageEvents.consoleErrors.push(msg.text().slice(0, 300));
  });
  p.on('response', (res) => {
    if (res.status() >= 500) pageEvents.serverErrors.push(`${res.status()} ${res.url()}`);
  });
}

async function cmdLaunch(args) {
  const { chromium } = await import('playwright-core');
  const channels = args.channels || ['msedge', 'chrome'];
  const timeoutMs = args.timeoutMs || 20_000;
  let lastErr = '';
  for (const channel of channels) {
    try {
      browser = await chromium.launch({ channel, headless: true, timeout: timeoutMs });
      context = await browser.newContext({
        viewport: args.viewport || { width: 1280, height: 800 },
      });
      return { channel };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  throw new Error(lastErr || 'no browser channel available');
}

async function cmdOpenAndNavigate(args) {
  if (!context) throw new Error('not launched');
  page = await context.newPage();
  resetPageEvents();
  attachListeners(page);
  try {
    await page.goto(args.url, { waitUntil: 'load', timeout: args.timeoutMs || 25_000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function cmdScreenshot() {
  if (!page) throw new Error('no page open');
  const buf = await page.screenshot({ type: 'png' });
  return { buffer: buf.toString('base64') };
}

/** One-shot navigate + settle + collect + screenshot + close, mirroring browser-smoke.ts's per-path check. */
async function cmdCheckPath(args) {
  if (!context) throw new Error('not launched');
  if (page) await page.close().catch(() => {});
  page = await context.newPage();
  resetPageEvents();
  attachListeners(page);

  const finding = {
    httpStatus: 0,
    navigationError: null,
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    screenshotPath: null,
  };
  try {
    const res = await page.goto(args.url, {
      waitUntil: 'load',
      timeout: args.timeoutMs || 25_000,
    });
    finding.httpStatus = res ? res.status() : 0;
    await page.waitForTimeout(args.settleMs || 2_000);
    if (args.screenshotPath) {
      await page.screenshot({ path: args.screenshotPath, fullPage: false }).catch(() => {});
      finding.screenshotPath = args.screenshotPath;
    }
  } catch (e) {
    finding.navigationError = (e && e.message ? e.message : String(e)).slice(0, 300);
  }
  finding.pageErrors = pageEvents.pageErrors;
  finding.consoleErrors = pageEvents.consoleErrors;
  finding.serverErrors = pageEvents.serverErrors;
  await page.close().catch(() => {});
  page = null;
  return finding;
}

async function cmdClose() {
  if (browser) await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  return { ok: true };
}

const HANDLERS = {
  launch: cmdLaunch,
  openAndNavigate: cmdOpenAndNavigate,
  screenshot: cmdScreenshot,
  checkPath: cmdCheckPath,
  close: cmdClose,
};

async function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // Malformed input must not crash the worker or wedge the protocol.
  }
  const handler = HANDLERS[msg.cmd];
  if (!handler) {
    process.stdout.write(`${JSON.stringify({ id: msg.id, ok: false, error: `unknown cmd: ${msg.cmd}` })}\n`);
    return;
  }
  try {
    const result = await handler(msg.args || {});
    process.stdout.write(`${JSON.stringify({ id: msg.id, ok: true, result })}\n`);
    if (msg.cmd === 'close') {
      // Flush the response before exiting so the client's `close` call resolves.
      setImmediate(() => process.exit(0));
    }
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({ id: msg.id, ok: false, error: e && e.message ? e.message : String(e) })}\n`,
    );
  }
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx = buffer.indexOf('\n');
  while (idx >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) void handleLine(line);
    idx = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => process.exit(0));
