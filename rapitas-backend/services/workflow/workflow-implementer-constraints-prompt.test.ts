/**
 * workflow-implementer-constraints-prompt — failed self-verify checks go back
 * to the implementer (task 1602)
 */
import { describe, expect, test } from 'bun:test';
import { buildImplementerConstraints } from './workflow-implementer-constraints-prompt';

describe('buildImplementerConstraints failed-check rule', () => {
  test('ja: fix every failing check using its hints, re-run, finish only on ok:true', () => {
    const text = buildImplementerConstraints(1602, 'ja');
    expect(text).toContain('落ちた検査をすべて直してから自己検証をやり直し');
    expect(text).toContain('`failureFiles`');
    expect(text).toContain('`gateMessage`');
    expect(text).toContain('`fixHint`');
    expect(text).toContain('`ok:true` になってから終えて');
    expect(text).toContain('3回やり直しても通らない場合だけ');
  });

  test('en: the same rule in English', () => {
    const text = buildImplementerConstraints(1602, 'en');
    expect(text).toContain('fix every failed check before re-running self-verification');
    expect(text).toContain('`failureFiles`');
    expect(text).toContain('`gateMessage`');
    expect(text).toContain('`fixHint`');
    expect(text).toContain('finish only once it returns `ok:true`');
    expect(text).toContain('Only if it still fails after 3 re-runs');
  });
});
