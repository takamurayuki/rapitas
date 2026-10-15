/**
 * risk-evidence.test
 *
 * Covers the evidence-first risk floor: declared change targets and the
 * research agent's verdict decide, and a task that only TALKS about a risky
 * area no longer buys a premium model.
 */
import { describe, test, expect } from 'bun:test';
import { isRiskyDeclaredPath, resolveRiskFromEvidence } from './risk-evidence';

const NL = String.fromCharCode(10);
const doc = (...lines: string[]) => lines.join(NL);
const BT = String.fromCharCode(96);
const code = (p: string) => BT + p + BT;

describe('isRiskyDeclaredPath', () => {
  test('schema, migration, auth, payment and billing targets are risky', () => {
    expect(isRiskyDeclaredPath('rapitas-backend/prisma/schema/core.prisma')).toBe(true);
    expect(isRiskyDeclaredPath('prisma/migrations/20260101_x/migration.sql')).toBe(true);
    expect(isRiskyDeclaredPath('services/auth/session.ts')).toBe(true);
    expect(isRiskyDeclaredPath('services/billing/invoice.ts')).toBe(true);
    expect(isRiskyDeclaredPath('src/payment-gateway.ts')).toBe(true);
  });

  test('ordinary source files are not', () => {
    expect(isRiskyDeclaredPath('services/workflow/routing-policy.ts')).toBe(false);
    expect(isRiskyDeclaredPath('rapitas-frontend/src/components/TaskCard.tsx')).toBe(false);
    // 'author' merely starts with 'auth' — not a path segment, not a basename word.
    expect(isRiskyDeclaredPath('services/blog/authorship.ts')).toBe(false);
  });

  test('windows separators normalise', () => {
    const win = ['rapitas-backend', 'prisma', 'schema', 'core.prisma'].join(
      String.fromCharCode(92),
    );
    expect(isRiskyDeclaredPath(win)).toBe(true);
  });
});

describe('resolveRiskFromEvidence', () => {
  test('returns null before any artifact exists so the keyword fallback still applies', () => {
    expect(resolveRiskFromEvidence({})).toBeNull();
    expect(resolveRiskFromEvidence({ researchContent: null, planContent: null })).toBeNull();
  });

  test('a plan that declares a schema file is high risk', () => {
    const planContent = doc(
      '### 変更',
      '| ファイル | 目的 |',
      `| ${code('prisma/schema/core.prisma')} | モデル追加 |`,
    );
    const r = resolveRiskFromEvidence({ planContent });
    expect(r?.high).toBe(true);
    expect(r?.source).toBe('declared_files');
  });

  test('a path the plan decided NOT to touch does not count as declared', () => {
    // Real shape: a 検討事項 row that declines a schema edit, alongside the files
    // the plan actually changes (task 658).
    const planContent = doc(
      '### 変更',
      `- ${code('rapitas-backend/services/memory/rag/search.ts')}`,
      '### 検討事項',
      `| 6 | ${code('MemoryTaskQueue.taskType')} のコメント（${code('prisma/schema/memory.prisma')}）に ` +
        `${code('reembed')} を足すか | 足さない。schema ファイルの編集は再起動が必要 |`,
    );
    const r = resolveRiskFromEvidence({ planContent });
    expect(r?.high).toBe(false);
    expect(r?.source).toBe('evidence_clear');
  });

  test('a plan whose ONLY risky mention is declined yields no evidence at all', () => {
    // Nothing declared once the declined row is blanked — that is not proof of
    // safety, so the caller keeps its keyword fallback rather than clearing the
    // floor on an empty plan.
    const planContent = `（${code('prisma/schema/memory.prisma')}）に足すか | 足さない |`;
    expect(resolveRiskFromEvidence({ planContent })).toBeNull();
  });

  test("research's own 高 verdict raises the floor even without a plan", () => {
    const researchContent = doc(
      '## リスク判定',
      'リスク: 高',
      '対象領域: 認証',
      '根拠: session.ts を変更',
    );
    const r = resolveRiskFromEvidence({ researchContent });
    expect(r?.high).toBe(true);
    expect(r?.source).toBe('research_verdict');
  });

  test('a 低 verdict with an ordinary plan clears the floor', () => {
    const researchContent = doc('## リスク判定', 'リスク: 低', '対象領域: なし');
    const planContent = `### 変更${NL}- ${code('services/workflow/routing-policy.ts')}`;
    const r = resolveRiskFromEvidence({ researchContent, planContent });
    expect(r?.high).toBe(false);
    expect(r?.source).toBe('evidence_clear');
  });

  test('a declared schema file wins over a 低 verdict', () => {
    const researchContent = doc('## リスク判定', 'リスク: 低', '対象領域: なし');
    const planContent = `### 変更${NL}- ${code('prisma/schema/agents.prisma')}`;
    expect(resolveRiskFromEvidence({ researchContent, planContent })?.high).toBe(true);
  });

  test('a plan with no readable path and no verdict yields no evidence', () => {
    expect(resolveRiskFromEvidence({ planContent: '# 実装計画' + NL + '手順を書く' })).toBeNull();
  });
});
