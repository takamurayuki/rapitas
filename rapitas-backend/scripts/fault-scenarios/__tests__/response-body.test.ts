/**
 * response-body.test
 *
 * Unit tests for readFailedResponseBody — the helper that puts a failed
 * response's body into a fault scenario's detail so CI logs can diagnose it.
 */
import { describe, it, expect } from 'bun:test';
import { readFailedResponseBody, RESPONSE_BODY_MAX_CHARS } from '../common';

function res(text: (() => Promise<string>) | undefined, status = 500): Response {
  return { ok: false, status, text } as unknown as Response;
}

describe('readFailedResponseBody', () => {
  it('includes the body when present', async () => {
    const out = await readFailedResponseBody(res(async () => 'P2022 column Task.foo missing'));
    expect(out).toContain('P2022 column Task.foo missing');
  });

  it('states explicitly that the body was empty', async () => {
    const out = await readFailedResponseBody(res(async () => '  '));
    expect(out).toContain('no body');
    expect(out).toContain('レスポンス本文は空でした');
    expect(out).toContain('status=500');
  });

  it('keeps only the first 500 characters of a long body', async () => {
    const out = await readFailedResponseBody(res(async () => 'x'.repeat(2000)));
    expect(out).toContain('x'.repeat(RESPONSE_BODY_MAX_CHARS));
    expect(out).not.toContain('x'.repeat(RESPONSE_BODY_MAX_CHARS + 1));
    expect(out).toContain('省略');
  });

  it('reports a read failure instead of throwing', async () => {
    const out = await readFailedResponseBody(
      res(async () => {
        throw new Error('socket closed');
      }),
    );
    expect(out).toContain('レスポンス本文を読めませんでした');
    expect(out).toContain('socket closed');
  });

  it('tolerates a response without text()', async () => {
    const out = await readFailedResponseBody(res(undefined));
    expect(out).toContain('レスポンス本文を読めませんでした');
  });
});
