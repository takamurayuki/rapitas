/**
 * theme-saturation ユニットテスト
 *
 * lcsLen と findSaturatedTheme（idea/concern 共通の anti-monoculture ゲート）を検証。
 */
import { describe, expect, mock, test } from 'bun:test';

let pool: Array<{ id: number; title: string; content?: string; forgettingStage?: string }> = [];
let lastWhere: Record<string, unknown> | null = null;
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return Promise.resolve(
          pool.filter(
            (row) =>
              !where.forgettingStage || (row.forgettingStage ?? 'active') === where.forgettingStage,
          ),
        );
      },
    },
  },
}));

const {
  lcsLen,
  findSaturatedTheme,
  charBigrams,
  bigramJaccard,
  findNearDuplicate,
  stripTitleMarkers,
  isContentRelated,
} = await import('./theme-saturation');

describe('lcsLen', () => {
  test('共通部分文字列の最長長を返す', () => {
    expect(
      lcsLen('gen:type-guards の Prettier 同期', 'gen:type-guards が Prettier 非互換'),
    ).toBeGreaterThanOrEqual(8);
    expect(lcsLen('freee OCR 仕訳', '通知音の設定')).toBeLessThan(4);
  });
});

describe('bigramJaccard / charBigrams', () => {
  test('正規化で空白・区切りを無視する', () => {
    expect([...charBigrams('a b-c')]).toEqual(['ab', 'bc']);
  });
  test('同一タイトルは 1.0', () => {
    expect(bigramJaccard('型ガード生成のCI組み込み', '型ガード生成のCI組み込み')).toBe(1);
  });
  test('カタカナ揺れのクローンは高スコア（≥0.45）', () => {
    // The exact near-clone the extractor keeps re-filing — caught at 0.45.
    const s = bigramJaccard(
      'コマンド型ゲートの実体取り込み（SSOT/型ガード/クリティカルガード）',
      'コマンド型ゲートの実装（SSOT/型ガード/クリティカルガード）',
    );
    expect(s).toBeGreaterThanOrEqual(0.45);
  });
  test('同一テーマの別ファセットは低スコア（<0.45・過剰拒否しない）', () => {
    const s = bigramJaccard(
      'Jaccard閾値の動的調整・学習機構',
      'ドキュメント構造ガイドの自動生成・保守',
    );
    expect(s).toBeLessThan(0.45);
  });
  test('空文字は 0', () => {
    expect(bigramJaccard('', 'abc')).toBe(0);
  });
});

describe('findNearDuplicate', () => {
  test('archived concern cannot swallow a new filing, but an active duplicate still can', async () => {
    pool = [
      { id: 77, title: 'Codex command execution output is missing', forgettingStage: 'archived' },
    ];
    const options = { sourceType: 'concern', openConcernOnly: true };
    expect(await findNearDuplicate(pool[0].title, options, 0.45)).toBeNull();
    pool[0].forgettingStage = 'active';
    expect(await findNearDuplicate(pool[0].title, options, 0.45)).toBe(77);
  });
  test('閾値以上の近重複が存在 → その id を返す', async () => {
    pool = [
      { id: 21, title: 'ゲート登録APIの宣言的・汎用フレームワーク化' },
      { id: 22, title: 'コマンド型ゲートの実体取り込み（SSOT/型ガード/クリティカルガード）' },
    ];
    const r = await findNearDuplicate(
      'コマンド型ゲートの実装（SSOT/型ガード/クリティカルガード）',
      { sourceType: 'idea_box' },
      0.45,
    );
    expect(r).toBe(22);
  });
  test('近重複が無ければ null（別ファセットは通す）', async () => {
    pool = [
      { id: 31, title: 'Jaccard閾値の動的調整・学習機構' },
      { id: 32, title: 'docs/ 健全性ゲートを ci-gates.ts に組み込み定期検証化' },
    ];
    const r = await findNearDuplicate(
      'ドキュメント構造ガイドの自動生成・保守',
      { sourceType: 'idea_box' },
      0.45,
    );
    expect(r).toBeNull();
  });
});

describe('findSaturatedTheme', () => {
  test('hidden concerns do not saturate the visible backlog', async () => {
    pool = Array.from({ length: 3 }, (_, id) => ({
      id,
      title: `Codex process runner repair ${id}`,
      forgettingStage: 'archived',
    }));
    pool.push({ id: 100, title: 'Codex process runner output', forgettingStage: 'active' });
    const options = { sourceType: 'concern', openConcernOnly: true, cap: 3, salient: 8 };
    expect(await findSaturatedTheme('Codex process runner events', options)).toBeNull();
    pool.push({ id: 101, title: 'Codex process runner timing', forgettingStage: 'active' });
    pool.push({ id: 102, title: 'Codex process runner errors', forgettingStage: 'active' });
    expect(await findSaturatedTheme('Codex process runner events', options)).toBe(100);
  });
  test('CAP件以上が salient 部分文字列を共有 → anchor id を返す（飽和）', async () => {
    pool = Array.from({ length: 3 }, (_, i) => ({
      id: 10 + i,
      title: `gen:type-guards の Prettier 整形 ${i}`,
    }));
    const r = await findSaturatedTheme('gen:type-guards の Prettier 同期メカニズム', {
      sourceType: 'concern',
      cap: 3,
      salient: 8,
      openConcernOnly: true,
    });
    expect(r).toBe(10);
    expect(lastWhere).toEqual({
      sourceType: 'concern',
      sourceId: 'open',
      forgettingStage: 'active',
    });
  });

  test('新規テーマ（共有なし）→ null（許可）', async () => {
    pool = Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, title: `gen:type-guards ${i}` }));
    const r = await findSaturatedTheme('freeeレシートOCRの自動仕訳プレビュー機能', {
      sourceType: 'idea_box',
      cap: 8,
      salient: 4,
    });
    expect(r).toBeNull();
  });

  test('CAP未満なら許可', async () => {
    pool = [
      { id: 10, title: 'gen:type-guards の Prettier 整形 A' },
      { id: 11, title: 'gen:type-guards の Prettier 整形 B' },
    ];
    const r = await findSaturatedTheme('gen:type-guards の Prettier 同期', {
      sourceType: 'concern',
      cap: 3,
      salient: 8,
    });
    expect(r).toBeNull(); // only 2 < cap 3
  });
});

describe('findSaturatedTheme — minJaccardで無関係トピックの誤爆を防ぐ (#888)', () => {
  test('短い共通語（Codex）だけを共有する無関係な懸念群は minJaccard 指定時は飽和と判定しない', async () => {
    // #7336相当: salient=5のLCS一致だけでは「Codex」という技術用語のみを共有する
    // 無関係な3件が theme-saturation の cap に達し、新規の全く別内容の懸念を誤って吸収した。
    pool = [
      { id: 201, title: 'Codex CLIのログイン状態確認手順について' },
      { id: 202, title: 'Codex CLIの応答速度に関する計測結果メモ' },
      { id: 203, title: 'Codex CLI利用時のネットワーク設定ガイド' },
    ];

    const anchor = await findSaturatedTheme('Codex 監督者による質問検出ロジックの構造化失敗調査', {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
      minJaccard: 0.2,
    });

    expect(anchor).toBeNull();
  });

  test('本文全体が重なる真の重複クラスタは minJaccard 指定時も引き続き飽和と判定する（回帰）', async () => {
    pool = [
      { id: 11, title: '[Bug] 境界値テスト自動生成が壊れる' },
      { id: 12, title: '[Idea] 境界値テスト自動生成の改善' },
      { id: 13, title: '[改善] 境界値テスト自動生成の整理' },
    ];

    const anchor = await findSaturatedTheme('[Bug] 境界値テスト自動生成をやり直す', {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
      minJaccard: 0.2,
    });

    expect(anchor).toBe(11);
  });
});

describe('isContentRelated — detail の二次関連性チェック (#967)', () => {
  test('共有バイグラムが閾値未満の無関係な detail は false', () => {
    const a =
      '決済APIのリトライ処理でタイムアウト後に再送すると二重課金が発生する場合がある。冪等キーの検証を強化する必要がある。';
    const b =
      'PDF出力機能で帳票を生成すると日本語フォントが埋め込まれず文字化けする。フォント埋め込み設定の見直しが必要。';
    expect(isContentRelated(a, b)).toBe(false);
  });
  test('共有バイグラムが閾値以上の関連する detail は true', () => {
    const a =
      '境界値テスト自動生成ツールがnullケース周りで例外を出しCIが失敗する不具合を再修正する。';
    const b =
      '境界値テスト自動生成ツールがnullケースで例外を投げてCIが落ちる。生成ロジックのnull分岐を確認する必要がある。';
    expect(isContentRelated(a, b)).toBe(true);
  });
  test('detail が未指定/短すぎる場合は判定不能としてフォールバック true', () => {
    expect(isContentRelated(undefined, '何らかの詳細本文')).toBe(true);
    expect(isContentRelated('短い', '別の短い文')).toBe(true);
  });
});

describe('findSaturatedTheme — newDetail による無関係アンカー誤ヒットの防止 (#967)', () => {
  const candidates = [
    {
      id: 301,
      title: '[Bug] PDF出力処理が正しく動作しない',
      content:
        'PDF出力機能で帳票を生成すると日本語フォントが埋め込まれず文字化けする。フォント埋め込み設定の見直しが必要。',
    },
    {
      id: 302,
      title: '[Bug] メール送信処理が正しく動作しない',
      content:
        'メール送信バッチが添付ファイルサイズ上限を超えると無言で送信を諦めてしまう。エラーログにも記録が残らない。',
    },
    {
      id: 303,
      title: '[Bug] キャッシュ削除処理が正しく動作しない',
      content:
        'キャッシュ削除ジョブが並行実行されるとロック競合で片方が失敗し、古いキャッシュが残り続けることがある。',
    },
  ];
  const newTitle = '[Bug] 決済リトライ処理が正しく動作しない';
  const newDetail =
    '決済APIのリトライ処理でタイムアウト後に再送すると二重課金が発生する場合がある。冪等キーの検証を強化する必要がある。';

  test('タイトルのみでは salient+minJaccard を満たし飽和扱いになる（newDetail 未指定の従来挙動）', async () => {
    pool = candidates;
    const anchor = await findSaturatedTheme(newTitle, {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
      minJaccard: 0.2,
    });
    expect(anchor).toBe(301);
  });

  test('newDetail を渡すと内容が無関係なため飽和と判定しない（誤ヒット解消）', async () => {
    pool = candidates;
    const anchor = await findSaturatedTheme(newTitle, {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
      minJaccard: 0.2,
      newDetail,
    });
    expect(anchor).toBeNull();
  });

  test('本文も強く関連する真の重複クラスタは newDetail 指定時も引き続き飽和と判定する（回帰）', async () => {
    pool = [
      {
        id: 11,
        title: '[Bug] 境界値テスト自動生成が壊れる',
        content:
          '境界値テスト自動生成ツールがnullケースで例外を投げてCIが落ちる。生成ロジックのnull分岐を確認する必要がある。',
      },
      {
        id: 12,
        title: '[Idea] 境界値テスト自動生成の改善',
        content:
          '境界値テスト自動生成ツールの出力にnullケースが含まれずCIで例外検知が漏れる問題を改善したい。',
      },
      {
        id: 13,
        title: '[改善] 境界値テスト自動生成の整理',
        content: '境界値テスト自動生成ツールのnullケース処理を整理し、CIでの例外の見逃しを防ぐ。',
      },
    ];
    const anchor = await findSaturatedTheme('[Bug] 境界値テスト自動生成をやり直す', {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
      minJaccard: 0.2,
      newDetail:
        '境界値テスト自動生成ツールがnullケース周りで例外を出しCIが失敗する不具合を再修正する。',
    });
    expect(anchor).toBe(11);
  });
});

describe('書式マーカーは同一テーマとみなさない', () => {
  test('角括弧のマーカーを除去する', () => {
    expect(stripTitleMarkers('[Bug] 登録ポイントが競合する')).toBe('登録ポイントが競合する');
    expect(stripTitleMarkers('[ログ:ERROR] git command failed')).toBe('git command failed');
    expect(stripTitleMarkers('[自己検出] 停滞: 放置される')).toBe('停滞: 放置される');
  });

  test('[Bug] を共有するだけでは飽和と判定しない', async () => {
    // 実測 2026-08-27: [Bug] はちょうど5文字（懸念の salient 長）で、開いている
    // 懸念23件が保持していた。そのため新しい [Bug] 懸念はマーカーだけで cap=3 を
    // 越え、呼び出し側には success を返しながら無言で捨てられていた。
    pool = [
      { id: 1, title: '[Bug] まったく別の話題A' },
      { id: 2, title: '[Bug] まったく別の話題B' },
      { id: 3, title: '[Bug] まったく別の話題C' },
      { id: 4, title: '[Bug] まったく別の話題D' },
    ];

    const anchor = await findSaturatedTheme('[Bug] 登録ポイントが必ず競合する', {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
    });

    expect(anchor).toBeNull();
  });

  test('本文が本当に重なっていれば従来どおり飽和と判定する', async () => {
    pool = [
      { id: 11, title: '[Bug] 境界値テスト自動生成が壊れる' },
      { id: 12, title: '[Idea] 境界値テスト自動生成の改善' },
      { id: 13, title: '[改善] 境界値テスト自動生成の整理' },
    ];

    const anchor = await findSaturatedTheme('[Bug] 境界値テスト自動生成をやり直す', {
      sourceType: 'concern',
      cap: 3,
      salient: 5,
      openConcernOnly: true,
    });

    expect(anchor).toBe(11);
  });
});
