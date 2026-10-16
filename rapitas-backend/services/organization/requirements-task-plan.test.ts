/**
 * requirements-task-plan.test
 *
 * Project generation writes requirements.md, design.md and ADRs and then stops:
 * nothing turns those documents into implementation tasks. Measured 2026-10-11
 * — theme 35 (TempoRaid) had its environment built and then ZERO implementation
 * tasks, while the four tasks that did exist were all rapitas's own defects
 * filed there by mistake. The log-derived and idea-box filers only ever produce
 * rapitas work, so an app's own features were never planned at all.
 *
 * The generated requirements.md is highly regular, which is what makes parsing
 * it reasonable rather than guesswork: every feature carries an `[F-NN]` id, the
 * acceptance criteria are keyed by the SAME ids in Given/When/Then form, and
 * out-of-scope items are listed explicitly.
 */
import { describe, expect, it } from 'bun:test';
import { parseRequirementTasks, outOfScopeItems } from './requirements-task-plan';

const DOC = `# 概要

音楽からダンジョンを生成する協力プレイゲーム。

# 機能要件

- [F-01] 音声読込と解析
  - 入力: 音声ファイル(最大20MB、10分以内)。
  - 処理: ブラウザ内のWorkerでFFTを使う。
  - 出力: BeatMap JSON(bpm, beats[])。
- [F-02] ビートマップ共有
  - 入力: BeatMapとfingerprint(SHA-256)。
  - 処理: サーバーが保存し、同一fingerprintは再利用する。
  - 出力: beatmapId。

# 画面一覧

- ロビー: 曲読込ドロップゾーン。

# 受け入れ基準

- [F-01] Given 3分のmp3 When 読込 Then 15秒以内にBPM(±2)が得られる。
- [F-02] Given 同一fingerprint When 2回目に登録 Then 同じbeatmapIdが返る。

# スコープ外

- モバイル/ネイティブアプリ
- 音声チャット、課金
`;

describe('parseRequirementTasks', () => {
  it('yields one spec per [F-NN], in document order', () => {
    const specs = parseRequirementTasks(DOC);
    expect(specs.map((s) => s.id)).toEqual(['F-01', 'F-02']);
    expect(specs.map((s) => s.title)).toEqual(['音声読込と解析', 'ビートマップ共有']);
  });

  it('keeps the 入力/処理/出力 body as the spec detail', () => {
    const [first] = parseRequirementTasks(DOC);
    expect(first.detail).toContain('入力: 音声ファイル');
    expect(first.detail).toContain('出力: BeatMap JSON');
    // Must not bleed into the next feature.
    expect(first.detail).not.toContain('fingerprint');
  });

  it('attaches the acceptance criterion keyed by the same id', () => {
    const specs = parseRequirementTasks(DOC);
    expect(specs[0].acceptanceCriteria).toEqual([
      'Given 3分のmp3 When 読込 Then 15秒以内にBPM(±2)が得られる。',
    ]);
    expect(specs[1].acceptanceCriteria[0]).toContain('同じbeatmapIdが返る');
  });

  it('leaves acceptance criteria empty rather than borrowing another feature’s', () => {
    // A document whose criteria section omits F-02 must not hand F-01's to it:
    // an unverifiable task is better than one with the wrong bar.
    const doc = DOC.replace(
      '- [F-02] Given 同一fingerprint When 2回目に登録 Then 同じbeatmapIdが返る。\n',
      '',
    );
    const specs = parseRequirementTasks(doc);
    expect(specs[1].id).toBe('F-02');
    expect(specs[1].acceptanceCriteria).toEqual([]);
  });

  it('returns nothing for a document with no 機能要件 section', () => {
    expect(parseRequirementTasks('# 概要\n\nまだ何もない。\n')).toEqual([]);
    expect(parseRequirementTasks('')).toEqual([]);
  });

  it('ignores a feature id that appears outside the 機能要件 section', () => {
    // The acceptance-criteria section repeats every id; counting those would
    // double every task.
    const specs = parseRequirementTasks(DOC);
    expect(specs).toHaveLength(2);
  });

  it('tolerates full-width brackets and extra spacing', () => {
    const doc = '# 機能要件\n\n-  ［F-07］  協力攻撃(ユニゾン)\n  - 処理: 同一ビート窓。\n';
    const specs = parseRequirementTasks(doc);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe('F-07');
    expect(specs[0].title).toBe('協力攻撃(ユニゾン)');
  });

  // Measured 2026-10-12 against the live generator (「ドリフトユニオン」, 177s,
  // 7 features): the model wrote its 機能要件 as `### [F-01] …` headings, since
  // each feature carries an 入力/処理/出力 block. The bullet-only regex matched
  // none of them, so a complete 6.2KB requirements document parsed as ZERO
  // features — the same silent "nothing was filed" outcome the fallback
  // template's `- **[F-01] …**` shape produced on 2026-10-11. The filer must
  // accept every shape a feature declaration plausibly takes, because the
  // failure is invisible: no error, just no tasks.
  describe('feature declaration shapes', () => {
    const body = '\n  - 入力: メール・パスワード。\n  - 出力: セッション。\n';

    for (const [shape, line] of [
      ['### heading (live generator)', '### [F-01] アカウント登録・ログイン'],
      ['## heading', '## [F-01] アカウント登録・ログイン'],
      ['bold bullet (fallback template)', '- **[F-01] アカウント登録・ログイン**'],
      ['bold bullet with colon', '- **[F-01] アカウント登録・ログイン**: 概要。'],
      ['checkbox bullet', '- [ ] [F-01] アカウント登録・ログイン'],
      ['colon after the id', '- [F-01]: アカウント登録・ログイン'],
    ] as const) {
      it(`parses a feature written as ${shape}`, () => {
        const specs = parseRequirementTasks(`# 機能要件\n\n${line}${body}`);
        expect(specs.map((s) => s.id)).toEqual(['F-01']);
        expect(specs[0].title).toContain('アカウント登録・ログイン');
        // The body must still attach, not be swallowed by the declaration line.
        expect(specs[0].detail).toContain('入力: メール・パスワード');
      });
    }

    it('keeps heading-declared features separate instead of merging their bodies', () => {
      const doc =
        '# 機能要件\n\n### [F-01] ログイン\n  - 入力: メール。\n\n### [F-02] 移動の開始\n  - 入力: 目的地。\n';
      const specs = parseRequirementTasks(doc);
      expect(specs.map((s) => s.id)).toEqual(['F-01', 'F-02']);
      expect(specs[0].detail).not.toContain('目的地');
      expect(specs[1].detail).toContain('目的地');
    });

    it('does not treat a section heading as a feature', () => {
      // `# 機能要件` itself and sibling sections must never become specs.
      const specs = parseRequirementTasks(DOC);
      expect(specs.map((s) => s.id)).toEqual(['F-01', 'F-02']);
    });

    it('reads criteria written with a checkbox prefix', () => {
      const doc =
        '# 機能要件\n\n- [F-01] ログイン\n\n# 受け入れ基準\n\n- [ ] [F-01] Given 未登録 When 登録 Then 201 が返る。\n';
      const specs = parseRequirementTasks(doc);
      expect(specs[0].acceptanceCriteria).toEqual(['Given 未登録 When 登録 Then 201 が返る。']);
    });
  });
});

describe('outOfScopeItems', () => {
  it('lists the explicit non-goals so they can bound the task', () => {
    expect(outOfScopeItems(DOC)).toEqual(['モバイル/ネイティブアプリ', '音声チャット、課金']);
  });

  it('is empty when the document declares no scope limits', () => {
    expect(outOfScopeItems('# 機能要件\n\n- [F-01] x\n')).toEqual([]);
  });
});
