/**
 * fallback-package.test
 *
 * Pins the properties that make the fallback safe to ship: it must announce
 * itself as a scaffold, must NOT present an invented technology rationale as a
 * real decision, and must score itself honestly. A ContextFlow run on
 * 2026-10-08 shipped this package as a finished "96点" specification and
 * blocked implementation, which is what these assertions exist to prevent.
 */

import { describe, expect, it } from 'vitest';
import { buildFallbackResponse } from './fallback-package';

const proposal = {
  id: 'p1',
  name: 'ContextFlow',
  tagline: '伝え方を学習する',
  concept: '過去のやりとりからコミュニケーションパターンを学習する',
  unique: '誰にどう伝えるかを学習する',
  difficulty: 'hard',
  tech_hint: ['Next.js 14', 'PostgreSQL', 'TypeScript'],
};

const build = () => buildFallbackResponse(proposal, 'Web + スマホ全対応', 'large');

describe('buildFallbackResponse', () => {
  it('scores itself as a scaffold, not as a finished specification', () => {
    expect(build().score).toBe(20);
  });

  // Measured 2026-10-11: the template's 機能要件 used `- **[F-01] …**` and its
  // criteria `- [ ] [F-01] …`, and the filer's FEATURE_BULLET regex matches
  // neither. A degraded package scaffolded into a project therefore parsed as
  // ZERO features and filed no implementation tasks at all — silently
  // reproducing the gap theme 35 started from. The shape must stay parseable.
  it('writes features and criteria in the shape the task filer parses', () => {
    const requirements = build().requirements ?? '';
    // Plain `- [F-NN] <name>` bullets, no bold wrapper, no checkbox prefix.
    for (const id of ['F-01', 'F-02', 'F-03']) {
      expect(requirements).toContain(`- [${id}] `);
    }
    expect(requirements).not.toMatch(/- \*\*\[F-\d+\]/);
    expect(requirements).not.toMatch(/- \[ \] \[F-\d+\]/);
  });

  it('models three acceptance criteria per feature, not one', () => {
    const requirements = build().requirements ?? '';
    const criteriaBlock = requirements.slice(requirements.indexOf('# 受け入れ基準'));
    for (const id of ['F-01', 'F-02', 'F-03']) {
      const n = (criteriaBlock.match(new RegExp(`- \\[${id}\\] `, 'g')) ?? []).length;
      expect(n, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('carries the assumptions section, since every value here is assumed', () => {
    expect(build().requirements ?? '').toContain('# 前提と未決事項');
  });

  it('banners every document that lands in the repository', () => {
    const r = build();
    for (const doc of [r.requirements, r.design, r.adr]) {
      expect(doc).toContain('自動生成に失敗したため');
    }
  });

  it('says in the rationale itself that generation failed', () => {
    expect(build().tech_rationale).toContain('AI生成は失敗しました');
  });

  it('records NO decision rather than inventing one', () => {
    // An invented rationale would be read as a real decision and inherited by
    // every later change — worse than an empty record.
    const { adr } = build();
    expect(adr).toContain('記録なし');
    expect(adr).toContain('技術選定の意思決定は行われていません');
    // It must not claim alternatives were weighed.
    expect(adr).toContain('代替案の比較も却下理由の検討も行われていません');
  });

  it('lists the decisions a human has to make, with the required fields', () => {
    const { adr } = build();
    for (const heading of ['ADR-0001', 'ADR-0002', 'ADR-0003']) {
      expect(adr).toContain(heading);
    }
    for (const field of ['文脈', '検討した代替案', '却下理由', 'トレードオフ', '撤回条件']) {
      expect(adr).toContain(field);
    }
  });

  it('ships no project skeleton rather than one for an invented stack', () => {
    // Same reason the ADR records nothing: a package.json for a stack nobody
    // chose would produce a project that LOOKS set up, and the next agent would
    // build on invented dependencies.
    expect(build().scaffold).toEqual([]);
  });

  it('points the agent guide at all three spec documents', () => {
    const { claude_md } = build();
    expect(claude_md).toContain('docs/requirements.md');
    expect(claude_md).toContain('docs/design.md');
    expect(claude_md).toContain('docs/adr/0001-architecture-decisions.md');
  });

  it('falls back to a default stack only when no tech hint was given', () => {
    const withHint = build().design;
    expect(withHint).toContain('PostgreSQL');
    const withoutHint = buildFallbackResponse({ ...proposal, tech_hint: [] }, 'Web', 'solo').design;
    expect(withoutHint).toContain('Supabase');
  });
});
