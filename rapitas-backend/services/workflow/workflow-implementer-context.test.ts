/**
 * workflow-implementer-context.test — buildTddProtocolSection
 *
 * Covers the TDD-adoption scope decision (bug-fix / feature / trivial) and
 * the RED/GREEN protocol text injected for each, in both languages. The rest
 * of buildImplementerContext is DB-backed and covered indirectly elsewhere;
 * this function was extracted specifically to be testable in isolation.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildDependencyChangeGuidance,
  buildTddProtocolSection,
} from './workflow-implementer-context';

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
