/**
 * spec-consistency.test
 *
 * The wizard generates the requirements / design / ADR package in one shot and
 * the user has no chance to spot a gap before implementation starts. Measured
 * 2026-10-11 on TempoRaid: 12 features shipped with exactly ONE acceptance
 * criterion each, and its 12 implementation tasks produced 6 verify_repair
 * bounces — several on behaviour the spec never pinned (task 1185's agent wrote
 * its own concurrent-join case because only capacity was specified).
 *
 * These tests pin the checks that catch such gaps from the text alone.
 */

import { describe, expect, test } from 'bun:test';
import {
  checkSpecConsistency,
  specIsImplementable,
  MIN_CRITERIA_PER_FEATURE,
  ASSUMPTIONS_SECTION,
  REACHABILITY_SECTION,
} from './spec-consistency';

/** A document set with no findings, used as the baseline to break per test. */
const GOOD_REQUIREMENTS = `# 概要

音楽からダンジョンを生成する協力プレイゲーム。

# 機能要件

- [F-01] 音声読込と解析
  - 入力: 音声ファイル。
- [F-02] ルーム作成と参加
  - 処理: サーバーが保存する。

# 受け入れ基準

- [F-01] Given 3分のmp3 When 読込 Then 15秒以内にBPMが得られる。
- [F-01] Given 20MB超 When 読込 Then 拒否される。
- [F-01] Given 破損ファイル When 読込 Then エラーが表示される。
- [F-02] Given 有効なコード When 参加 Then 4人まで入れる。
- [F-02] Given 5人目 When 参加 Then 拒否される。
- [F-02] Given 無効なコード When 参加 Then 404 が返る。

# ${REACHABILITY_SECTION}

- [F-01] \`/\` のアップロードパネル → ファイルを選択 → 同画面に解析結果が出る
- [F-02] \`/rooms\` の「ルームを作る」 → コードが表示される

# ${ASSUMPTIONS_SECTION}

- 同時接続数はヒアリング未実施。1万人と仮定（決定者: PO / 期限: 着手前）。

# スコープ外

- モバイルアプリ
`;

const GOOD_DESIGN = `# アーキテクチャ概要

クライアントとサーバー。ADR-0001 を参照。

# 技術スタック

| 区分 | 技術 | バージョン | 選定理由 |
| --- | --- | --- | --- |
| DB | PostgreSQL | 16 | [F-01] の解析結果を永続化するため |

# API設計

- POST /api/beatmaps — [F-01]
- POST /api/rooms — [F-02]
`;

const GOOD_ADR = `# 技術選定記録 (ADR)

## ADR-0001: データストアの選択

- **決定**: PostgreSQL 16
`;

const good = () => ({
  requirements: GOOD_REQUIREMENTS,
  design: GOOD_DESIGN,
  adr: GOOD_ADR,
});

const codes = (docs: Parameters<typeof checkSpecConsistency>[0]) =>
  checkSpecConsistency(docs).map((f) => f.code);

describe('checkSpecConsistency', () => {
  test('a complete document set produces no findings', () => {
    expect(checkSpecConsistency(good())).toEqual([]);
    expect(specIsImplementable(checkSpecConsistency(good()))).toBe(true);
  });

  test('flags a feature with no acceptance criterion as an error', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace(/- \[F-02\] Given[^\n]*\n/g, '');
    const findings = checkSpecConsistency(docs);
    expect(findings.some((f) => f.code === 'missing_criteria' && f.featureId === 'F-02')).toBe(
      true,
    );
    expect(specIsImplementable(findings)).toBe(false);
  });

  test('flags one criterion per feature — the shape TempoRaid shipped', () => {
    const docs = good();
    // Keep only the first criterion of each feature.
    docs.requirements = docs.requirements
      .replace('- [F-01] Given 20MB超 When 読込 Then 拒否される。\n', '')
      .replace('- [F-01] Given 破損ファイル When 読込 Then エラーが表示される。\n', '')
      .replace('- [F-02] Given 5人目 When 参加 Then 拒否される。\n', '')
      .replace('- [F-02] Given 無効なコード When 参加 Then 404 が返る。\n', '');
    const findings = checkSpecConsistency(docs);
    const few = findings.filter((f) => f.code === 'too_few_criteria');
    expect(few.map((f) => f.featureId).sort()).toEqual(['F-01', 'F-02']);
    expect(few[0]?.message).toContain(String(MIN_CRITERIA_PER_FEATURE));
    // A thin spec is a warning, not a blocker: it is still implementable.
    expect(specIsImplementable(findings)).toBe(true);
  });

  test('flags a criterion whose feature no longer exists', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace('- [F-02] ルーム作成と参加\n', '');
    expect(codes(docs)).toContain('orphan_criteria');
  });

  test('flags a feature that never appears in the design', () => {
    const docs = good();
    docs.design = docs.design.replace('- POST /api/rooms — [F-02]\n', '');
    const findings = checkSpecConsistency(docs);
    expect(findings.some((f) => f.code === 'untraced_feature' && f.featureId === 'F-02')).toBe(
      true,
    );
  });

  test('requires the assumptions section so unknowns are not implied', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace(`# ${ASSUMPTIONS_SECTION}`, '# 別の見出し');
    const findings = checkSpecConsistency(docs);
    expect(findings.some((f) => f.code === 'missing_assumptions_section')).toBe(true);
    expect(specIsImplementable(findings)).toBe(false);
  });

  test('flags an ADR that is referenced but never written', () => {
    const docs = good();
    docs.design = docs.design.replace('ADR-0001 を参照', 'ADR-0007 を参照');
    const findings = checkSpecConsistency(docs);
    expect(
      findings.some((f) => f.code === 'dangling_adr_ref' && f.message.includes('ADR-0007')),
    ).toBe(true);
  });

  test('flags a technology choice left open in the stack table', () => {
    const docs = good();
    docs.design = docs.design.replace('PostgreSQL | 16', 'PostgreSQL または MySQL | 16');
    expect(codes(docs)).toContain('vague_tech_choice');
  });

  test('empty requirements short-circuits to a single error', () => {
    expect(checkSpecConsistency({ requirements: '' })).toEqual([
      { code: 'no_requirements', severity: 'error', message: '要件定義書が空です。' },
    ]);
    expect(checkSpecConsistency({})).toHaveLength(1);
  });

  test('a missing design is a warning, not a silent pass', () => {
    const findings = checkSpecConsistency({ requirements: GOOD_REQUIREMENTS, adr: GOOD_ADR });
    expect(findings.some((f) => f.code === 'no_design')).toBe(true);
    // Without a design there is nothing to trace against, so no per-feature noise.
    expect(findings.some((f) => f.code === 'untraced_feature')).toBe(false);
  });

  test('errors are listed before warnings', () => {
    const docs = good();
    docs.requirements = docs.requirements
      .replace(`# ${ASSUMPTIONS_SECTION}`, '# 別の見出し')
      .replace('- [F-01] Given 20MB超 When 読込 Then 拒否される。\n', '')
      .replace('- [F-01] Given 破損ファイル When 読込 Then エラーが表示される。\n', '');
    const severities = checkSpecConsistency(docs).map((f) => f.severity);
    expect(severities.indexOf('error')).toBeLessThan(severities.indexOf('warning'));
  });

  test('tolerates full-width brackets, matching the filer’s own parser', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace(
      '- [F-02] ルーム作成と参加',
      '- ［F-02］ルーム作成と参加',
    );
    // Still recognised as F-02, so no orphan/missing findings appear.
    expect(codes(docs)).toEqual([]);
  });
});

describe('画面導線の検査 (2026-10-12)', () => {
  // 実測 2026-10-12 TempoRaid: 12 機能すべてが単体テスト付きで実装・自動マージ
  // されたが、画面に繋がっていたのは F-01 だけで、しかもその結果は文字列表示のみ。
  // web アプリの .tsx は App.tsx と AudioLoadPanel.tsx の 2 つしかなく、F-02..F-12
  // の画面は存在しない。store/app-store.ts と net/reconnecting-client.ts は
  // どこからも import されていない。受入基準が「モジュールの振る舞い」だけだったため
  // 単体テストで満たせてしまった。導線を要件に明記させ、無ければ実装に進ませない。
  /** Drop one `# <name>` section, by index rather than by regex. */
  function withoutSection(markdown: string, name: string): string {
    const start = markdown.indexOf(`# ${name}`);
    if (start < 0) throw new Error(`fixture has no section ${name}`);
    const next = markdown.indexOf('\n# ', start + 1);
    return markdown.slice(0, start) + (next < 0 ? '' : markdown.slice(next + 1));
  }

  test('画面導線セクションが無ければ error', () => {
    const docs = good();
    docs.requirements = withoutSection(docs.requirements, REACHABILITY_SECTION);
    expect(docs.requirements).not.toContain(REACHABILITY_SECTION);
    const findings = checkSpecConsistency(docs);
    const f = findings.find((x) => x.code === 'missing_reachability_section');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('error');
    expect(specIsImplementable(findings)).toBe(false);
  });

  test('導線が書かれていない機能があれば、その機能を名指しして error', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace(
      '- [F-02] `/rooms` の「ルームを作る」 → コードが表示される\n',
      '',
    );
    const findings = checkSpecConsistency(docs);
    const f = findings.find((x) => x.code === 'unreachable_feature');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('F-02');
    expect(specIsImplementable(findings)).toBe(false);
  });

  test('導線が揃っていれば指摘は出ない', () => {
    const findings = checkSpecConsistency(good());
    expect(findings.filter((f) => /reachab|unreachable/.test(f.code))).toEqual([]);
    expect(specIsImplementable(findings)).toBe(true);
  });

  test('導線に画面も操作も書かれていなければ error（ラベルだけの行は無効）', () => {
    const docs = good();
    docs.requirements = docs.requirements.replace(
      '- [F-02] `/rooms` の「ルームを作る」 → コードが表示される',
      '- [F-02] あとで決める',
    );
    const findings = checkSpecConsistency(docs);
    const f = findings.find((x) => x.code === 'vague_reachability');
    expect(f).toBeDefined();
    expect(f?.message).toContain('F-02');
  });
});
