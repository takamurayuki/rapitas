/**
 * candidates.test
 *
 * 自由記述から選択肢を生成する部分のパーサとプロンプト。
 *
 * 背景（2026-10-12 の報告）: 固定カタログ（ジャンル12・要素20）が入力の上限に
 * なっているため、提案プロンプトが「ありふれたジャンルは禁止」と書いていても
 * 出力が収束する。選択肢そのものを題材から作ることで天井を外す。
 *
 * パーサの契約は「壊れた応答は空配列に落とす」こと。候補が無ければウィザードは
 * 定番カタログを出すだけで、今より悪くならない。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCandidatePrompt,
  parseCandidates,
  normalizeConcept,
  MAX_CANDIDATES,
  MAX_CONCEPT_CHARS,
} from '../candidates';

describe('parseCandidates', () => {
  it('素のJSONを解釈する', () => {
    const got = parseCandidates(
      '{"candidates":[{"id":"meeting_actions","label":"会話から実行抽出","reason":"議事録が本題"}]}',
    );
    expect(got).toHaveLength(1);
    expect(got[0].label).toBe('会話から実行抽出');
    expect(got[0].reason).toBe('議事録が本題');
  });

  it('```json フェンス付きでも解釈する', () => {
    const got = parseCandidates(
      '説明\n```json\n{"candidates":[{"id":"a","label":"あ"}]}\n```\n後置き',
    );
    expect(got.map((c) => c.label)).toEqual(['あ']);
  });

  it('idに ai_ を付けて定番カタログと衝突させない', () => {
    // 'auth' は既存 ELEMENTS のID。前置きが無いと定番を置き換えてしまう。
    const got = parseCandidates('{"candidates":[{"id":"auth","label":"認証"}]}');
    expect(got[0].id).toBe('ai_auth');
  });

  it('使えない文字のidを正規化し、空なら連番を振る', () => {
    const got = parseCandidates(
      '{"candidates":[{"id":"ある 題材!","label":"あ"},{"id":"","label":"い"}]}',
    );
    expect(got[0].id).toMatch(/^ai_[a-z0-9_]+$/);
    expect(got[1].id).toBe('ai_cand2');
  });

  it('label が無い項目は捨てる（カードに出せない）', () => {
    const got = parseCandidates(
      '{"candidates":[{"id":"a"},{"id":"b","label":"い"},{"id":"c","label":"   "}]}',
    );
    expect(got.map((c) => c.label)).toEqual(['い']);
  });

  it('id と label の重複を落とす', () => {
    const got = parseCandidates(
      '{"candidates":[{"id":"a","label":"あ"},{"id":"a","label":"別"},{"id":"b","label":"あ"}]}',
    );
    expect(got).toHaveLength(1);
  });

  it('上限を超える件数は切る', () => {
    const many = Array.from(
      { length: MAX_CANDIDATES + 3 },
      (_, i) => `{"id":"x${i}","label":"ラベル${i}"}`,
    );
    expect(parseCandidates(`{"candidates":[${many.join(',')}]}`)).toHaveLength(MAX_CANDIDATES);
  });

  it('空の reason は undefined にする（空文字をツールチップに出さない）', () => {
    const got = parseCandidates('{"candidates":[{"id":"a","label":"あ","reason":"  "}]}');
    expect(got[0].reason).toBeUndefined();
  });

  for (const [name, raw] of [
    ['壊れたJSON', '{"candidates":[}'],
    ['candidates が配列でない', '{"candidates":"いろいろ"}'],
    ['candidates が無い', '{"other":[]}'],
    ['JSONが無い', 'すみません、分かりませんでした'],
    ['空文字', ''],
  ] as const) {
    it(`${name} は空配列に落とす（定番カタログで継続できる）`, () => {
      expect(parseCandidates(raw)).toEqual([]);
    });
  }
});

describe('normalizeConcept', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeConcept('  作りたいもの  ')).toBe('作りたいもの');
  });

  it('長すぎる入力を切る（貼り付けでプロンプトを壊さない）', () => {
    expect(normalizeConcept('あ'.repeat(MAX_CONCEPT_CHARS + 50))).toHaveLength(MAX_CONCEPT_CHARS);
  });

  it('未入力は空文字（任意入力なので呼び出し側がスキップできる）', () => {
    expect(normalizeConcept(null)).toBe('');
    expect(normalizeConcept(undefined)).toBe('');
    expect(normalizeConcept('   ')).toBe('');
  });
});

describe('buildCandidatePrompt', () => {
  it('ジャンルでは既存12分類への当てはめを禁じる', () => {
    const p = buildCandidatePrompt('genre');
    expect(p).toContain('当てはめようとせず');
    expect(p).toContain('ゲーム/SNS/EC');
  });

  it('要素では汎用機能を挙げさせない（定番側と重複するため）', () => {
    expect(buildCandidatePrompt('elements')).toContain('汎用機能');
  });

  it('どの段でも件数上限と JSON 形式を指示する', () => {
    for (const level of ['genre', 'subs', 'elements'] as const) {
      const p = buildCandidatePrompt(level);
      expect(p).toContain(String(MAX_CANDIDATES));
      expect(p).toContain('JSONのみ');
    }
  });
});
