/**
 * workflow-implementer-context.test — buildTddProtocolSection
 *
 * Covers the TDD-adoption scope decision (bug-fix / feature / trivial) and
 * the RED/GREEN protocol text injected for each, in both languages. The rest
 * of buildImplementerContext is DB-backed and covered indirectly elsewhere;
 * this function was extracted specifically to be testable in isolation.
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  buildDependencyChangeGuidance,
  buildImplementerContext,
  buildPrismaOperationGuidance,
  buildPlanSection,
  buildTddProtocolSection,
} from './workflow-implementer-context';

// TempoRaid task 1403 (2026-11-23) asked twice whether its plan was the saved
// approved version; the prompt now says so right under the plan heading.
describe('buildPlanSection', () => {
  test('puts the saved-version identity between the heading and the plan', () => {
    const plan = '# 計画\n\n- [ ] 一つ目\n';
    const section = buildPlanSection('## 実装計画', plan, 'ja');
    const heading = section.indexOf('## 実装計画');
    const identity = section.indexOf('保存されている承認済み');
    const body = section.indexOf('# 計画');
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(identity).toBeGreaterThan(heading);
    expect(body).toBeGreaterThan(identity);
  });
});

describe('buildDependencyChangeGuidance', () => {
  test('ja: forbids install/add in any shape and says to record the package in verify', () => {
    const g = buildDependencyChangeGuidance('ja');
    for (const w of ['pnpm add', 'package.json', 'ls node_modules/.bin', 'verify']) {
      expect(g).toContain(w);
    }
    expect(g).toContain('何もインストールされません');
  });

  test('en: same guidance in English', () => {
    const g = buildDependencyChangeGuidance('en');
    expect(g).toContain('rejected in any shape');
    expect(g).toContain('record its name, version, and why it is needed');
  });
});

describe('buildPrismaOperationGuidance', () => {
  test('ja: conditional on a hook refusal, names all three operations and leaves applying to the user', () => {
    const g = buildPrismaOperationGuidance('ja');
    for (const w of [
      '拒否',
      'generate',
      'db push',
      'migrate',
      'prisma validate',
      'schema.prisma',
      'verify',
      'ユーザー',
      '対象プロジェクト',
    ]) {
      expect(g).toContain(w);
    }
    // AGENTS.md: the Prisma schema is not edited inside a worktree.
    expect(g).not.toContain('手書き');
  });

  test('en: same guidance in English', () => {
    const g = buildPrismaOperationGuidance('en');
    for (const w of [
      'rejects',
      'generate',
      'db push',
      'migrate',
      'prisma validate',
      'schema.prisma',
      'verify',
      'the user',
      'project own rules',
    ]) {
      expect(g).toContain(w);
    }
    expect(g).not.toContain('by hand');
  });
});

describe('buildImplementerContext', () => {
  // The assembler reads memory, pitfalls, metrics etc. from the database; stub those
  // layers so the test only observes how the prompt is put together.
  mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => null }));
  mock.module('./workflow-memory-context', () => ({ buildMemoryContext: async () => '' }));
  mock.module('./workflow-pitfall-context', () => ({ buildKnownPitfallsSection: async () => '' }));
  mock.module('./workflow-hypothesis-context', () => ({ buildHypothesisContext: async () => '' }));
  mock.module('./workflow-case-context', () => ({ buildCaseContext: async () => '' }));
  mock.module('./workflow-goal-anchor', () => ({ buildGoalAnchor: async () => '' }));
  mock.module('./workflow-context-metrics', () => ({ recordContextMetrics: async () => {} }));
  mock.module('./workflow-context-snapshot', () => ({
    snapshotSection: async (_t: number, _k: string, build: () => Promise<string>) => build(),
  }));
  mock.module('./learning/repair-risk-tactic-section', () => ({
    buildRepairRiskTacticSection: async () => '',
  }));
  mock.module('./phase-critic', () => ({ buildCriticLessonsSection: async () => '' }));

  test.each(['ja', 'en'] as const)(
    'includes the prisma guidance block for %s',
    async (language) => {
      const texts = { leadWithPlan: 'LEAD', leadNoPlan: 'LEAD', constraints: 'C' };
      const ctx = await buildImplementerContext(
        987654321,
        { title: 'docs', description: null },
        language,
        'lightweight',
        'INFO',
        texts as never,
        'Q',
        'S',
      );
      expect(ctx).toContain(buildPrismaOperationGuidance(language));
      expect(ctx.indexOf(buildDependencyChangeGuidance(language))).toBeLessThan(
        ctx.indexOf(buildPrismaOperationGuidance(language)),
      );
    },
  );
});

describe('buildTddProtocolSection', () => {
  test.each(['ja', 'en'] as const)(
    'returns the bug-fix protocol (RED/GREEN + must-fail-without-diff check) for %s',
    async (language) => {
      const section = await buildTddProtocolSection(
        'ログイン後にクラッシュするバグを修正する',
        language,
      );
      expect(section).not.toBe('');
      expect(section).toContain(language === 'ja' ? 'バグ修正の必須手順' : 'Bug-fix protocol');
      expect(section).toContain(language === 'ja' ? 'RED' : 'RED');
      expect(section).toContain(language === 'ja' ? 'GREEN' : 'GREEN');
      expect(section).toContain(
        language === 'ja'
          ? '本差分のソース変更なしでは実際に失敗する'
          : "genuinely fails without this diff's source changes",
      );
    },
  );

  test.each(['ja', 'en'] as const)(
    'returns the general TDD protocol (acceptance-criteria framed, not defect-framed) for a feature task in %s',
    async (language) => {
      const section = await buildTddProtocolSection(
        '新しいエクスポートAPIエンドポイントを追加する',
        language,
      );
      expect(section).not.toBe('');
      expect(section).toContain(language === 'ja' ? 'TDDの必須手順' : 'TDD protocol');
      expect(section).not.toContain(language === 'ja' ? '不具合を再現' : 'reproduces the defect');
      expect(section).toContain(
        language === 'ja'
          ? '本差分のソース変更なしでは実際に失敗する'
          : "genuinely fails without this diff's source changes",
      );
    },
  );

  test.each(['ja', 'en'] as const)('returns empty for a docs-only task in %s', async (language) => {
    const section = await buildTddProtocolSection('READMEのみ更新する', language);
    expect(section).toBe('');
  });

  test.each(['ja', 'en'] as const)(
    'returns empty for a dependency-bump-only task in %s',
    async (language) => {
      const section = await buildTddProtocolSection('依存関係のバージョンを更新のみ', language);
      expect(section).toBe('');
    },
  );
});
