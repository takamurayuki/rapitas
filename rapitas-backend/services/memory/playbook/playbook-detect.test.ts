/**
 * playbook-detect ユニットテスト
 *
 * 変更ファイル抽出(表あり/表なし/plan fallback入力/複数行)、ファイル集合Jaccard、
 * 同型クラスタ判定(AND複合条件)、注入ランキング(rankPlaybooks)を検証する。
 * 純関数のみ — prisma は theme-saturation の import 連鎖用にモックする。
 */
import { describe, expect, mock, test } from 'bun:test';

// bigramJaccard の import 連鎖(theme-saturation)が実DBへ触れないよう遮断。
mock.module('../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const {
  extractChangedFiles,
  extractPlaybookTargetFiles,
  fileSetJaccard,
  detectPlaybookCluster,
  rankPlaybooks,
  TITLE_MIN_SIMILARITY,
  FILESET_MIN_JACCARD,
} = await import('./playbook-detect');

const VERIFY_WITH_TABLE = [
  '# Verification Report',
  '## 検証結果サマリ',
  '✅ 検証成功',
  '## 変更ファイル',
  '| ファイル | 種別 | 変更内容 |',
  '| --- | --- | --- |',
  '| `services/settings/general.ts` | 変更 | トグル追加 |',
  '| `services/settings/schema.ts:12` | 変更 | 1行追加 |',
  '| `components\\settings\\Panel.tsx` | 新規 | パネル |',
].join('\n');

const PLAN_WITH_TABLE = [
  '# 実装計画',
  '## 変更予定ファイル',
  '| # | ファイル | 目的 |',
  '| 1 | `services/settings/general.ts` | トグル |',
  '| 2 | `services/settings/toggles.test.ts` | テスト |',
].join('\n');

describe('extractChangedFiles', () => {
  test('変更ファイル表からバッククォートパスを抽出し正規化する', () => {
    const files = extractChangedFiles(VERIFY_WITH_TABLE);
    expect(files).toContain('services/settings/general.ts');
    // :行番号サフィックスは除去される
    expect(files).toContain('services/settings/schema.ts');
    // バックスラッシュは forward-slash に正規化される
    expect(files).toContain('components/settings/Panel.tsx');
    expect(files).toHaveLength(3);
  });

  test('表が無い(表行ゼロの)本文は空配列', () => {
    const md = '# report\n本文中の `services/settings/general.ts` は表ではない。';
    expect(extractChangedFiles(md)).toEqual([]);
  });

  test('plan fallback入力(変更予定ファイル表)からも非空で抽出できる', () => {
    const files = extractChangedFiles(PLAN_WITH_TABLE);
    expect(files).toContain('services/settings/general.ts');
    expect(files).toContain('services/settings/toggles.test.ts');
  });

  test('パスでないバッククォートトークン(コマンド・散文)は無視される', () => {
    const md = '| `bun test` | `general` | `a/b.ts` |';
    expect(extractChangedFiles(md)).toEqual(['a/b.ts']);
  });

  test('空文字は空配列', () => {
    expect(extractChangedFiles('')).toEqual([]);
  });
});

describe('extractPlaybookTargetFiles', () => {
  const CONTENT = [
    '## 対象ファイル',
    '- `services/settings/general.ts`',
    '- `services/settings/schema.ts`',
    '## 手順',
    '1. `other/file.ts` を編集(このセクションは対象外)',
  ].join('\n');

  test('対象ファイル節のパスのみ抽出する', () => {
    const files = extractPlaybookTargetFiles(CONTENT);
    expect(files).toEqual(['services/settings/general.ts', 'services/settings/schema.ts']);
  });

  test('対象ファイル節が無ければ空配列', () => {
    expect(extractPlaybookTargetFiles('## 手順\n- `a/b.ts`')).toEqual([]);
  });
});

describe('fileSetJaccard', () => {
  test('完全一致は1、無関係は0、部分重複は比率', () => {
    expect(fileSetJaccard(['a.ts', 'b.ts'], ['a.ts', 'b.ts'])).toBe(1);
    expect(fileSetJaccard(['a.ts'], ['b.ts'])).toBe(0);
    expect(fileSetJaccard(['a.ts', 'b.ts'], ['b.ts', 'c.ts'])).toBeCloseTo(1 / 3);
  });

  test('片側が空なら0', () => {
    expect(fileSetJaccard([], ['a.ts'])).toBe(0);
  });
});

describe('detectPlaybookCluster', () => {
  const current = {
    taskId: 100,
    title: '設定トグル追加: 自動リトライを設定画面から切り替え可能にする',
    files: ['services/settings/general.ts', 'services/settings/schema.ts'],
  };

  test('タイトル類似かつファイル重複の候補が1件以上でクラスタ成立(自身含め2件)', () => {
    const cluster = detectPlaybookCluster(current, [
      {
        taskId: 90,
        title: '設定トグル追加: 通知音を設定画面から切り替え可能にする',
        files: ['services/settings/general.ts', 'services/settings/schema.ts'],
      },
    ]);
    expect(cluster).not.toBeNull();
    expect(cluster?.members).toHaveLength(2);
    expect(cluster?.members[0].taskId).toBe(100);
  });

  test('候補0件(1件以下)ではnull', () => {
    expect(detectPlaybookCluster(current, [])).toBeNull();
  });

  test('タイトルは類似だが変更ファイルが無関係ならnull', () => {
    const cluster = detectPlaybookCluster(current, [
      {
        taskId: 91,
        title: '設定トグル追加: 通知音を設定画面から切り替え可能にする',
        files: ['routes/agents/monitoring.ts'],
      },
    ]);
    expect(cluster).toBeNull();
  });

  test('ファイルは重複するがタイトルが無関係ならnull', () => {
    const cluster = detectPlaybookCluster(current, [
      {
        taskId: 92,
        title: 'freee OCR 仕訳データの取込バグ修正',
        files: ['services/settings/general.ts', 'services/settings/schema.ts'],
      },
    ]);
    expect(cluster).toBeNull();
  });

  test('自分自身(同taskId)は候補から除外される', () => {
    expect(detectPlaybookCluster(current, [current])).toBeNull();
  });
});

describe('rankPlaybooks', () => {
  const playbooks = [
    { id: 1, title: '設定トグル追加の手順書' },
    { id: 2, title: '設定トグル追加: 設定画面トグルの追加手順書' },
    { id: 3, title: 'Prisma スキーマ分割の手順書' },
  ];

  test('タイトル類似度降順で閾値以上のみ返す', () => {
    const ranked = rankPlaybooks('設定トグル追加: 設定画面から切り替え', playbooks);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked[0].id).toBe(2);
    expect(ranked.every((r) => r.similarity >= TITLE_MIN_SIMILARITY)).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].similarity).toBeGreaterThanOrEqual(ranked[i].similarity);
    }
    // 無関係タイトルは閾値未満で落ちる
    expect(ranked.some((r) => r.id === 3)).toBe(false);
  });

  test('description プローブでもマッチできる(maxを採る)', () => {
    const ranked = rankPlaybooks(['全く別の題名', '設定トグル追加の手順を踏む'], playbooks);
    expect(ranked.length).toBeGreaterThanOrEqual(1);
  });

  test('空プローブのみなら空配列', () => {
    expect(rankPlaybooks([''], playbooks)).toEqual([]);
  });
});

describe('しきい値定数', () => {
  test('CBR整合の0.25 / ファイルAND条件0.34', () => {
    expect(TITLE_MIN_SIMILARITY).toBe(0.25);
    expect(FILESET_MIN_JACCARD).toBe(0.34);
  });
});
