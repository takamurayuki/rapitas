/**
 * stdin-prompt-writer tests
 */
import { describe, it, expect } from 'bun:test';
import { Writable } from 'stream';
import { writePromptChunks, isPipeClosedError } from './stdin-prompt-writer';

function epipe(): Error {
  return Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' });
}

describe('writePromptChunks', () => {
  it('writes the whole prompt and ends stdin', async () => {
    const got: Buffer[] = [];
    const w = new Writable({
      write(c, _e, cb) {
        got.push(c);
        cb();
      },
    });
    const r = await writePromptChunks(w, 'x'.repeat(40000), () => {});
    expect(r.completed).toBe(true);
    expect(Buffer.concat(got).length).toBe(40000);
    expect(w.writableEnded).toBe(true);
  });

  it('reports EPIPE as pipe-closed and does not hang on drain', async () => {
    const calls: boolean[] = [];
    const w = new Writable({
      highWaterMark: 1,
      write(_c, _e, cb) {
        // Simulate the child dying mid-write: error instead of draining.
        setTimeout(() => cb(epipe()), 5);
      },
    });
    const r = await Promise.race([
      writePromptChunks(w, 'x'.repeat(50000), (_e, closed) => calls.push(closed)),
      new Promise<'hang'>((res) => setTimeout(() => res('hang'), 2000)),
    ]);
    expect(r).not.toBe('hang');
    expect((r as { completed: boolean }).completed).toBe(false);
    expect(calls).toEqual([true]);
  });

  it('flags non-EPIPE errors as not pipe-closed', () => {
    expect(isPipeClosedError(new Error('boom'))).toBe(false);
    expect(isPipeClosedError(epipe())).toBe(true);
  });
});

describe('writePromptChunks: stream destroyed without error', () => {
  it('returns incomplete immediately when stdin is already destroyed', async () => {
    const w = new Writable({ write: (_c, _e, cb) => cb() });
    w.destroy();
    const r = await writePromptChunks(w, 'hello', () => {});
    expect(r.completed).toBe(false);
  });

  it('does not hang when destroyed silently while waiting for drain', async () => {
    const w = new Writable({
      highWaterMark: 1,
      write() {
        // never calls back; destroy() below emits close without an error
      },
    });
    setTimeout(() => w.destroy(), 10);
    const r = await Promise.race([
      writePromptChunks(w, 'x'.repeat(50000), () => {}),
      new Promise<'hang'>((res) => setTimeout(() => res('hang'), 2000)),
    ]);
    expect(r).not.toBe('hang');
    expect((r as { completed: boolean }).completed).toBe(false);
  });
});
