/**
 * briefing-core.test
 *
 * Pure-function tests for the night briefing: decision picking, script order,
 * placeholder safety and the 180-second cap (acceptance criteria 1, 2, 5).
 */
import { describe, it, expect } from 'bun:test';
import { pickDecision } from '../briefing-decision-picker';
import {
  buildBriefingScript,
  fillPlaceholders,
  renderScriptText,
} from '../briefing-script-builder';
import { estimateSeconds, BRIEFING_MAX_SECONDS, BRIEFING_MAX_CHARS } from '../briefing-duration';
import type { BriefingInput, DecisionCandidate } from '../briefing-types';

const cand = (o: Partial<DecisionCandidate> & { id: number }): DecisionCandidate => ({
  title: `task${o.id}`,
  priority: 'medium',
  dueDate: null,
  blockingCount: 0,
  reason: 'blocked',
  options: ['再開', '破棄'],
  ...o,
});

const baseInput = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  date: '2026-10-14',
  completed: [{ id: 1, title: 'ログイン修正', prNumber: 42 }],
  held: [{ id: 2, title: '決済API', reason: 'ブロック中' }],
  decisionCandidates: [cand({ id: 2, title: '決済API' })],
  linkUrl: '/agents/daily-report?date=2026-10-14',
  ...over,
});

const SECTION_ORDER = ['summary', 'completed', 'held', 'decision', 'link'];

describe('pickDecision', () => {
  it('returns null for no candidates', () => {
    expect(pickDecision([])).toBeNull();
  });
  it('returns one candidate ordered by priority > due > blocking > id', () => {
    const picked = pickDecision([
      cand({ id: 5, priority: 'low' }),
      cand({ id: 4, priority: 'high', dueDate: '2026-10-20' }),
      cand({ id: 3, priority: 'high', dueDate: '2026-10-15' }),
      cand({ id: 2, priority: 'high', dueDate: '2026-10-15', blockingCount: 3 }),
      cand({ id: 1, priority: 'high', dueDate: '2026-10-15', blockingCount: 3 }),
    ]);
    expect(picked?.id).toBe(1);
  });
  it('puts null due dates last', () => {
    expect(pickDecision([cand({ id: 1 }), cand({ id: 2, dueDate: '2026-11-01' })])?.id).toBe(2);
  });
});

describe('buildBriefingScript', () => {
  it('orders sections summary → completed → held → decision → link', () => {
    const s = buildBriefingScript(baseInput());
    expect(s.sections.map((x) => x.id)).toEqual(SECTION_ORDER);
    expect(s.decision?.id).toBe(2);
  });
  it('injects ids and PR numbers from structured data', () => {
    const text = renderScriptText(buildBriefingScript(baseInput()));
    expect(text).toContain('#1');
    expect(text).toContain('PR 42');
  });
  it('handles an empty day', () => {
    const s = buildBriefingScript(baseInput({ completed: [], held: [], decisionCandidates: [] }));
    expect(s.sections.length).toBe(5);
    expect(s.decision).toBeNull();
    expect(renderScriptText(s)).toContain('判断事項はありません');
  });
  it('rejects unknown placeholders', () => {
    expect(fillPlaceholders('完了{{completed}}件', { completed: '3' })).toBe('完了3件');
    expect(fillPlaceholders('{{evil}}', { completed: '3' })).toBeNull();
  });
  it('falls back when narrative has unknown placeholders', () => {
    const s = buildBriefingScript(baseInput(), { narrative: '{{nope}}' });
    expect(renderScriptText(s)).not.toContain('{{');
  });
});

describe('duration cap', () => {
  it('never exceeds 180s and keeps decision and link for huge input', () => {
    const completed = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      title: 'とても長いタスクタイトル'.repeat(10),
      prNumber: i,
    }));
    const held = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      title: '保留タスク'.repeat(10),
      reason: '理由'.repeat(40),
    }));
    const s = buildBriefingScript(
      baseInput({
        completed,
        held,
        decisionCandidates: [
          cand({ id: 7, title: '長い'.repeat(100), options: ['A'.repeat(100), 'B', 'C', 'D'] }),
        ],
      }),
    );
    const text = renderScriptText(s);
    expect(text.length).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(estimateSeconds(text)).toBeLessThanOrEqual(BRIEFING_MAX_SECONDS);
    expect(s.sections.map((x) => x.id)).toEqual(SECTION_ORDER);
    expect(text).toContain('他');
    expect(text).toContain('/agents/daily-report');
  });
  it('estimates 5 chars per second', () => {
    expect(estimateSeconds('あ'.repeat(900))).toBe(180);
    expect(estimateSeconds('あ'.repeat(901))).toBe(181);
  });
});
