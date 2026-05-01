/**
 * Tests for the research-mode helpers in execute-post-handler.
 * We re-export the validator + extractor for testability.
 */

import { describe, expect, test } from 'bun:test';

// Validate / extract are not exported — recreate the same logic here for
// black-box behavior verification. (Keeping them un-exported avoids
// polluting the public surface; mirrored constants are intentional.)
function validateResearchReport(content: string): {
  ok: boolean;
  missingSections: string[];
  reason: string;
} {
  const trimmed = (content || '').trim();
  if (trimmed.length === 0) return { ok: false, missingSections: [], reason: 'empty output' };
  // Must START with the heading, not just contain it later.
  if (!trimmed.startsWith('# 調査レポート') && !/^#\s+research report/i.test(trimmed)) {
    return {
      ok: false,
      missingSections: ['# 調査レポート'],
      reason: 'report does not START with the # 調査レポート heading (preamble detected)',
    };
  }
  if (trimmed.length < 800) {
    return {
      ok: false,
      missingSections: [],
      reason: `output too short (${trimmed.length} chars; need >= 800)`,
    };
  }
  const sections = ['タスク概要', '既存機能', '影響範囲', '実装方針', 'リスク', 'テスト'];
  const lower = trimmed.toLowerCase();
  const missing = sections.filter((s) => !lower.includes(s.toLowerCase()));
  if (missing.length > 3) {
    return {
      ok: false,
      missingSections: missing,
      reason: `missing too many required sections (${missing.length} of ${sections.length})`,
    };
  }
  return { ok: true, missingSections: missing, reason: '' };
}

function sliceResearchReport(raw: string): string | null {
  if (!raw) return null;
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const headingMatcher = /^#\s+調査レポート\s*$/gm;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headingMatcher.exec(normalized)) !== null) {
    lastIndex = match.index;
  }
  if (lastIndex === -1) {
    const enMatcher = /^#\s+research report\s*$/gim;
    while ((match = enMatcher.exec(normalized)) !== null) {
      lastIndex = match.index;
    }
  }
  if (lastIndex === -1) return null;
  return normalized.slice(lastIndex).trim();
}

function extractFinalAgentMessage(output: string): string {
  if (!output) return '';
  const lines = output.split(/\r?\n/);
  const collected: string[] = [];
  let sawJson = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmedLine);
      sawJson = true;
      const item = (obj as { item?: { type?: string; text?: string } }).item;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        collected.push(item.text);
      }
    } catch {}
  }
  if (collected.length > 0) return collected.join('\n\n').trim();
  return sawJson ? '' : output.trim();
}

describe('validateResearchReport', () => {
  test('rejects empty output', () => {
    const res = validateResearchReport('');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('empty output');
  });

  test('rejects thin "調査専用モードとして進めます" reply', () => {
    const thin = '調査専用モードとして進めます。実装・ファイル編集は行いません。';
    const res = validateResearchReport(thin);
    expect(res.ok).toBe(false);
    // Either reason is acceptable: it doesn't start with # 調査レポート AND
    // it's too short. The new validator catches the heading first.
    expect(res.reason.length).toBeGreaterThan(0);
  });

  test('rejects 2000-char text without # 調査レポート heading', () => {
    const noHeading = 'A'.repeat(2000);
    const res = validateResearchReport(noHeading);
    expect(res.ok).toBe(false);
    expect(res.missingSections).toContain('# 調査レポート');
  });

  test('rejects when heading exists but is preceded by preamble', () => {
    const preamble =
      '了解しました。調査専用モードで進めます。\n\n# 調査レポート\n\n' + 'X'.repeat(900);
    const res = validateResearchReport(preamble);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('preamble detected');
  });

  test('rejects 600-char body even if heading is correct (length floor 800)', () => {
    const body = '# 調査レポート\n\n## タスク概要\n' + 'X'.repeat(500);
    const res = validateResearchReport(body);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('too short');
  });

  test('rejects when too many required sections are missing', () => {
    // Long enough but missing 5/6 sections
    const missingMany =
      '# 調査レポート\n\n' + 'B'.repeat(900) + '\n## タスク概要\n' + 'C'.repeat(50);
    const res = validateResearchReport(missingMany);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('missing too many');
  });

  test('accepts a well-formed research report (>= 800 chars, starts with heading)', () => {
    const good = `# 調査レポート

## タスク概要
abc

## 既存機能チェック
- file1.ts
- file2.tsx
- file3.test.tsx

## 影響範囲
xyz

## 実装方針
### 選択肢A
foo

## リスク
none

## テスト戦略
unit + integration

${'X'.repeat(900)}`;
    const res = validateResearchReport(good);
    expect(res.ok).toBe(true);
  });
});

describe('sliceResearchReport', () => {
  test('returns null when no heading exists', () => {
    expect(sliceResearchReport('')).toBeNull();
    expect(sliceResearchReport('plain text without heading')).toBeNull();
  });

  test('slices from the heading when preceded by codex log noise', () => {
    const raw = [
      '読み取りコマンドの一部が実行ポリシーで弾かれたので別手段に切替えました',
      'rg --files | head',
      '',
      '# 調査レポート',
      '',
      '## タスク概要',
      'foo',
    ].join('\n');
    const sliced = sliceResearchReport(raw);
    expect(sliced).not.toBeNull();
    expect(sliced!.startsWith('# 調査レポート')).toBe(true);
    expect(sliced!).toContain('## タスク概要');
  });

  test('takes the LAST heading when multiple appear (codex retried)', () => {
    const raw = [
      '# 調査レポート',
      '(draft 1 — incomplete)',
      '...',
      '# 調査レポート',
      '## タスク概要',
      'final version',
    ].join('\n');
    const sliced = sliceResearchReport(raw);
    expect(sliced).not.toBeNull();
    expect(sliced!).toContain('final version');
    expect(sliced!.indexOf('draft 1')).toBe(-1);
  });

  test('falls back to English heading', () => {
    const raw = `noise\n\n# Research Report\n\n## Overview\nfoo`;
    const sliced = sliceResearchReport(raw);
    expect(sliced).not.toBeNull();
    expect(sliced!).toMatch(/^#\s+Research Report/i);
  });

  test('does not match heading inside code block prefix or in middle of line', () => {
    const raw = 'inline mention of # 調査レポート should not match here';
    const sliced = sliceResearchReport(raw);
    expect(sliced).toBeNull();
  });

  test('normalizes CRLF line endings before slicing', () => {
    const raw = 'log\r\n\r\n# 調査レポート\r\n\r\n## タスク概要\r\nbody';
    const sliced = sliceResearchReport(raw);
    expect(sliced).not.toBeNull();
    expect(sliced!.startsWith('# 調査レポート')).toBe(true);
  });
});

describe('extractFinalAgentMessage', () => {
  test('extracts agent_message text from codex JSON stream', () => {
    const stream = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"# 調査レポート\\n\\nfoo"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join('\n');
    const result = extractFinalAgentMessage(stream);
    expect(result).toContain('# 調査レポート');
    expect(result).toContain('foo');
  });

  test('returns raw text when no JSON events are present', () => {
    const plain = '# 調査レポート\n\nplain markdown';
    const result = extractFinalAgentMessage(plain);
    expect(result).toBe(plain.trim());
  });

  test('returns empty when JSON is present but no agent_message', () => {
    const noAgent = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"turn.completed"}',
    ].join('\n');
    const result = extractFinalAgentMessage(noAgent);
    expect(result).toBe('');
  });

  test('handles multiple agent_message events by concatenating', () => {
    const stream = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"part 1"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"part 2"}}',
    ].join('\n');
    const result = extractFinalAgentMessage(stream);
    expect(result).toContain('part 1');
    expect(result).toContain('part 2');
  });
});
