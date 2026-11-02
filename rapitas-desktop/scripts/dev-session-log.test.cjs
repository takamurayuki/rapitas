'use strict';
/**
 * dev-session-log.test
 *
 * The incident this encodes (2026-10-31): dev.js disappeared, the backend's
 * own exit-75 restart had nothing left to relaunch it, and both servers
 * stayed down. The backend's pino log showed the restart chain by pid
 * (41840 -> 15896 -> 17184) and then simply no fourth pid — because dev.js
 * logs to the terminal it was started from, and that record was gone. Why the
 * supervisor died could not be established from anything on disk.
 *
 * So these tests pin the two properties that make the next one answerable:
 * every dev.js log line also lands in a file, and the file can never be the
 * reason the dev server stops.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDevSessionLog } = require('./dev-session-log.cjs');

/** A fresh throwaway log directory per test. */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-session-log-'));
}

/** The ndjson lines currently in the session log. */
function readEvents(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test('writes one ndjson line carrying the event and its fields', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });

  session.appendDevEvent('dev_start', { argv: ['--watch'] });

  const events = readEvents(session.currentLogFile());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event, 'dev_start');
  assert.deepStrictEqual(events[0].argv, ['--watch']);
  assert.strictEqual(events[0].pid, process.pid);
  assert.ok(Date.parse(events[0].time) > 0, 'time must be an ISO instant');
});

test('appends, so an earlier event is never overwritten', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });

  session.appendDevEvent('first', {});
  session.appendDevEvent('second', {});

  assert.deepStrictEqual(
    readEvents(session.currentLogFile()).map((e) => e.event),
    ['first', 'second'],
  );
});

test('names the file per local day, beside the backend log', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir, now: () => new Date(2026, 9, 31, 19, 2) });

  assert.strictEqual(path.basename(session.currentLogFile()), 'dev-2026-10-31.ndjson');
});

// The whole point of this file is to survive the moment everything else is
// failing. A full disk or a locked file must not become the reason the dev
// server stops — that would be the observer causing the outage.
test('swallows a write failure instead of throwing', () => {
  const dir = tempDir();
  const blocked = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocked, 'this is a file, so mkdir inside it cannot work');
  const session = createDevSessionLog({ dir: path.join(blocked, 'logs') });

  assert.doesNotThrow(() => session.appendDevEvent('dev_start', {}));
});

test('wrapLogger still prints, and also records the level and message', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });
  const printed = [];
  const logger = {
    info: (msg) => printed.push(`info:${msg}`),
    warn: (msg) => printed.push(`warn:${msg}`),
    error: (msg) => printed.push(`error:${msg}`),
  };

  session.wrapLogger(logger);
  logger.info('starting backend');
  logger.warn('port 3001 busy');
  logger.error('spawn failed');

  // The terminal output is unchanged — this is a tee, not a redirect.
  assert.deepStrictEqual(printed, [
    'info:starting backend',
    'warn:port 3001 busy',
    'error:spawn failed',
  ]);
  const events = readEvents(session.currentLogFile());
  assert.deepStrictEqual(
    events.map((e) => [e.level, e.msg]),
    [
      ['info', 'starting backend'],
      ['warn', 'port 3001 busy'],
      ['error', 'spawn failed'],
    ],
  );
});

// dev.js prints colour and emoji. Escape sequences in a JSON log make it
// unreadable with jq and grep, which is the only way anyone will read it.
test('strips ANSI escapes from the recorded message', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  session.wrapLogger(logger);
  logger.info('\u001b[32mREADY\u001b[0m on 3001');

  assert.strictEqual(readEvents(session.currentLogFile())[0].msg, 'READY on 3001');
});

test('caps a runaway message so one line cannot fill the disk', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  session.wrapLogger(logger);
  logger.info('x'.repeat(10_000));

  const { msg } = readEvents(session.currentLogFile())[0];
  assert.ok(msg.length < 3_000, `message should be capped, got ${msg.length}`);
  assert.ok(msg.endsWith('…'), 'a truncated message should say so');
});

// dev.js's own header says most of the file still calls console.log directly
// and only the newer PID/health logging goes through `log`. Hooking `log`
// would therefore miss the startup narrative, which is exactly the part that
// says how far a failed start got.
test('wrapConsole tees the console, mapping log to info', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });
  const printed = [];
  const fake = {
    log: (...a) => printed.push(`log:${a.join(' ')}`),
    warn: (...a) => printed.push(`warn:${a.join(' ')}`),
    error: (...a) => printed.push(`error:${a.join(' ')}`),
  };

  session.wrapConsole(fake);
  fake.log('[ts] INFO  backend ready');
  fake.warn('[ts] WARN  port busy');
  fake.error('boom');

  assert.deepStrictEqual(printed, [
    'log:[ts] INFO  backend ready',
    'warn:[ts] WARN  port busy',
    'error:boom',
  ]);
  assert.deepStrictEqual(
    readEvents(session.currentLogFile()).map((e) => [e.event, e.level, e.msg]),
    [
      ['console', 'info', '[ts] INFO  backend ready'],
      ['console', 'warn', '[ts] WARN  port busy'],
      ['console', 'error', 'boom'],
    ],
  );
});

test('wrapConsole joins multiple arguments the way the console prints them', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });
  const fake = { log: () => {}, warn: () => {}, error: () => {} };

  session.wrapConsole(fake);
  fake.error('Unhandled rejection in dev.js:', 'ECONNRESET');

  assert.strictEqual(
    readEvents(session.currentLogFile())[0].msg,
    'Unhandled rejection in dev.js: ECONNRESET',
  );
});

// A hard kill (taskkill /F, SIGKILL) runs no handler, so no exit event can be
// written. The heartbeat is the only thing that distinguishes "killed" from
// "stopped cleanly without logging": a last heartbeat with no exit after it.
test('the heartbeat records that the supervisor was still alive', async () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });

  const timer = session.startHeartbeat(5);
  await new Promise((resolve) => setTimeout(resolve, 40));
  clearInterval(timer);

  const beats = readEvents(session.currentLogFile()).filter((e) => e.event === 'heartbeat');
  assert.ok(beats.length >= 1, `expected at least one heartbeat, got ${beats.length}`);
  assert.ok(typeof beats[0].uptimeSec === 'number');
});

// An interval that keeps the event loop alive would stop `node scripts/dev.js`
// from ever exiting on its own.
test('the heartbeat timer cannot hold the process open', () => {
  const dir = tempDir();
  const session = createDevSessionLog({ dir });

  const timer = session.startHeartbeat(60_000);
  try {
    assert.strictEqual(timer.hasRef(), false, 'the heartbeat timer must be unref()d');
  } finally {
    clearInterval(timer);
  }
});
