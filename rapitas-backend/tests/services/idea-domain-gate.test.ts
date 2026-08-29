/**
 * idea-domain-gate テスト (#738)
 *
 * 判定材料の結合・語彙オーバーラップ計算・フェイルオープン経路・
 * env判定関数の検証。回帰ケースはidea #5592/task #602の合成データを用いる。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const mockThemeFindFirst = mock(() => Promise.resolve<unknown>(null));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { theme: { findFirst: mockThemeFindFirst } },
}));

const mockWarn = mock(() => {});
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: mockWarn, error: () => {}, debug: () => {} }),
}));

const {
  buildThemeMaterial,
  domainOverlapScore,
  evaluateIdeaDomainFit,
  isDomainGateEnabled,
  getDomainGateMode,
} = await import('../../services/memory/idea-domain-gate');

describe('buildThemeMaterial', () => {
  test('4項目を空白結合する', () => {
    expect(
      buildThemeMaterial({
        name: 'ime-live-converter',
        description: '日本語IME向け',
        repositoryUrl: 'https://example/ime-live-converter',
        workingDirectory: 'C:/repos/ime',
      }),
    ).toBe('ime-live-converter 日本語IME向け https://example/ime-live-converter C:/repos/ime');
  });

  test('null・空文字は除外される', () => {
    expect(
      buildThemeMaterial({
        name: 'rapitas',
        description: null,
        repositoryUrl: '',
        workingDirectory: null,
      }),
    ).toBe('rapitas');
  });
});

describe('domainOverlapScore', () => {
  test('themeMaterialのbigramが空なら1を返す', () => {
    expect(domainOverlapScore('何か', '')).toBe(1);
  });

  test('回帰ケース: メディア変換系アイデア × IME系テーマは低スコア', () => {
    const themeMaterial = 'ime-live-converter 日本語IME向けのリアルタイム変換ライブラリ';
    const ideaText =
      'コンテキスト認識型プリセット推奨エンジン 動画/画像のメディア変換設定において、過去の変換履歴からプリセットを自動推薦する';
    expect(domainOverlapScore(ideaText, themeMaterial)).toBeLessThan(0.12);
  });

  test('正例: IME系アイデア × IME系テーマは高スコア', () => {
    const themeMaterial = 'ime-live-converter 日本語IME向けのリアルタイム変換ライブラリ';
    const ideaText =
      'IME変換候補プリセットの学習 日本語IMEの変換候補選択履歴からユーザー辞書プリセットを自動生成する';
    expect(domainOverlapScore(ideaText, themeMaterial)).toBeGreaterThanOrEqual(0.12);
  });
});

describe('evaluateIdeaDomainFit', () => {
  beforeEach(() => {
    mockThemeFindFirst.mockReset().mockReturnValue(Promise.resolve(null));
    mockWarn.mockClear();
  });

  test('テーマ未検出はフェイルオープン', async () => {
    const res = await evaluateIdeaDomainFit({ title: 't', content: 'c', themeId: 999 });
    expect(res.mismatch).toBe(false);
    expect(res.reason).toContain('テーマ未検出');
  });

  test('判定材料不足はフェイルオープン', async () => {
    mockThemeFindFirst.mockReturnValue(
      Promise.resolve({
        name: 'ab',
        description: null,
        repositoryUrl: null,
        workingDirectory: null,
      }),
    );
    const res = await evaluateIdeaDomainFit({ title: 't', content: 'c', themeId: 1 });
    expect(res.mismatch).toBe(false);
    expect(res.reason).toContain('判定材料不足');
  });

  test('回帰ケース: メディア変換系アイデア × ime-live-converterテーマはmismatch:true', async () => {
    mockThemeFindFirst.mockReturnValue(
      Promise.resolve({
        name: 'ime-live-converter',
        description: '日本語IME向けのリアルタイム変換ライブラリ',
        repositoryUrl: null,
        workingDirectory: null,
      }),
    );
    const res = await evaluateIdeaDomainFit({
      title: 'コンテキスト認識型プリセット推奨エンジン',
      content: '動画/画像のメディア変換設定において、過去の変換履歴からプリセットを自動推薦する',
      themeId: 1,
    });
    expect(res.mismatch).toBe(true);
  });

  test('正例: IME系アイデア × ime-live-converterテーマはmismatch:false', async () => {
    mockThemeFindFirst.mockReturnValue(
      Promise.resolve({
        name: 'ime-live-converter',
        description: '日本語IME向けのリアルタイム変換ライブラリ',
        repositoryUrl: null,
        workingDirectory: null,
      }),
    );
    const res = await evaluateIdeaDomainFit({
      title: 'IME変換候補プリセットの学習',
      content: '日本語IMEの変換候補選択履歴からユーザー辞書プリセットを自動生成する',
      themeId: 1,
    });
    expect(res.mismatch).toBe(false);
  });

  test('例外発生時はフェイルオープンしwarnが呼ばれる', async () => {
    mockThemeFindFirst.mockReturnValue(Promise.reject(new Error('db down')));
    const res = await evaluateIdeaDomainFit({ title: 't', content: 'c', themeId: 1 });
    expect(res.mismatch).toBe(false);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

describe('isDomainGateEnabled / getDomainGateMode', () => {
  afterEach(() => {
    delete process.env.RAPITAS_IDEA_DOMAIN_GATE;
    delete process.env.RAPITAS_IDEA_DOMAIN_GATE_MODE;
  });

  test.each([
    ['off', false],
    ['0', false],
    ['false', false],
    ['OFF', false],
    [undefined, true],
    ['on', true],
  ])('RAPITAS_IDEA_DOMAIN_GATE=%s -> %s', (value, expected) => {
    if (value === undefined) delete process.env.RAPITAS_IDEA_DOMAIN_GATE;
    else process.env.RAPITAS_IDEA_DOMAIN_GATE = value;
    expect(isDomainGateEnabled()).toBe(expected);
  });

  test.each([
    ['enforce', 'enforce'],
    ['ENFORCE', 'enforce'],
    [undefined, 'log'],
    ['log', 'log'],
    ['other', 'log'],
  ])('RAPITAS_IDEA_DOMAIN_GATE_MODE=%s -> %s', (value, expected) => {
    if (value === undefined) delete process.env.RAPITAS_IDEA_DOMAIN_GATE_MODE;
    else process.env.RAPITAS_IDEA_DOMAIN_GATE_MODE = value;
    expect(getDomainGateMode()).toBe(expected);
  });
});
