/**
 * spec-input-coverage.test
 *
 * 実測した非収束の再現（2026-10-13、ContextFlow F-01 / task #1214）。
 * 要件書の F-01 は `入力` に Slack / Gmail / Google Drive の3種を挙げたが、
 * 受け入れ基準3件と画面導線1件はすべて Slack のみを記述していた。
 * planner は基準どおり Slack に絞り（正しい）、verifier は `入力` 未充足を
 * 正直に報告して ⚠️一部失敗 とし、ゲートが差し戻した。Gmail / Drive には
 * 判定基準が無いので修復サイクルでは何も実装できず、合格に到達しない。
 * $7.71 を消費した。文書の時点で落とすのが唯一効く対処。
 */
import { describe, expect, test } from 'bun:test';
import { findUncoveredInputs } from './spec-input-coverage';

/** The real F-01 text, verbatim from the generated document. */
const CONTEXTFLOW = `# 機能要件

- [F-01] コミュニケーション履歴の取り込み
  - 入力: 管理者が選択したソース（Slackチャンネル、Gmail/メールラベル、Google Driveフォルダ）、OAuthトークン
  - 処理: 許可されたソースのみ差分取得し、ジョブキューで非同期に取り込む。
  - 出力: Message/Document レコード、取り込みジョブの状態と件数
- [F-02] 個人情報マスキングと権限付きインデックス化
  - 入力: 取り込み済みの本文
  - 処理: 正規表現でマスキング後、埋め込みベクトルを生成して保存する。
  - 出力: マスキング済み本文、埋め込み

# 受け入れ基準

- [F-01] Given 管理者が #sales チャンネルのみ許可 When 取り込みジョブを実行 Then #sales のメッセージのみ保存され、他チャンネルは0件
- [F-01] Given 取り込み済みの履歴がある When 差分取り込みを再実行 Then 既存メッセージは重複せず新規分のみ追加される
- [F-01] Given OAuthトークンが失効 When 取り込みを実行 Then ジョブが failed になり、エラー理由が /sources に表示される
- [F-02] Given 本文に電話番号 When マスキング Then 本文から除去される

# 画面導線

- [F-01] \`/sources\` の「Slackを接続」を押し、対象チャンネルを選んで「取り込み開始」を押す → ジョブ状態が一覧に表示される
- [F-02] \`/messages\` の行を開く → マスキング済み本文が表示される
`;

describe('findUncoveredInputs', () => {
  test('F-01 の Gmail / Drive が判定対象になっていないことを検出する（この事故の再現）', () => {
    const found = findUncoveredInputs(CONTEXTFLOW);
    expect(found).toHaveLength(1);
    expect(found[0].featureId).toBe('F-01');
    expect(found[0].covered).toContain('slack');
    expect(found[0].uncovered).toEqual(expect.arrayContaining(['gmail', 'drive']));
  });

  test('OAuth は対象に数えない（連携先ではなく認証方式）', () => {
    const found = findUncoveredInputs(CONTEXTFLOW);
    expect(found[0].uncovered).not.toContain('oauth');
    expect(found[0].covered).not.toContain('oauth');
  });

  test('入力の対象がすべて判定されていれば報告しない', () => {
    const doc = CONTEXTFLOW.replace(
      '- [F-01] Given OAuthトークンが失効 When 取り込みを実行 Then ジョブが failed になり、エラー理由が /sources に表示される',
      '- [F-01] Given Gmail と Google Drive を接続 When 取り込み Then 双方のレコードが保存される',
    );
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  test('入力に対象が1つだけなら報告しない', () => {
    const doc = `# 機能要件

- [F-01] 取り込み
  - 入力: Slackチャンネル
  - 出力: Message

# 受け入れ基準

- [F-01] Given Slack When 取り込み Then 保存される
`;
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  test('1件も判定されていない場合は報告しない（missing_criteria の領域）', () => {
    // 基準が全く無い機能は別の指摘で既に error になる。二重報告しない。
    const doc = `# 機能要件

- [F-01] 取り込み
  - 入力: SlackチャンネルとGmailラベル
  - 出力: Message

# 受け入れ基準

- [F-02] Given x When y Then z
`;
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  test('入力行が無い機能は対象外', () => {
    const doc = `# 機能要件

- [F-01] 取り込み
  - 処理: なにかする

# 受け入れ基準

- [F-01] Given x When y Then z
`;
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  test('他の機能の基準行で覆われたことにしない', () => {
    // F-02 の基準が Gmail に触れていても、F-01 の判定にはならない。
    const doc = `# 機能要件

- [F-01] 取り込み
  - 入力: SlackチャンネルとGmailラベル
  - 出力: Message
- [F-02] 通知
  - 入力: Gmail の受信
  - 出力: 通知

# 受け入れ基準

- [F-01] Given Slack When 取り込み Then 保存される
- [F-02] Given Gmail When 受信 Then 通知される
`;
    const found = findUncoveredInputs(doc);
    expect(found).toHaveLength(1);
    expect(found[0].featureId).toBe('F-01');
    expect(found[0].uncovered).toContain('gmail');
  });

  // 実測 2026-10-13: TempoRaid F-02 の入力「BeatMapとfingerprint(SHA-256)」で
  // sha-256 を連携先として誤検出した。ハッシュは入力の作り方であって連携先では
  // ないので、これを挙げても機能が判定不能になることはない。
  test('ハッシュ方式を連携先と誤検出しない（TempoRaid F-02 の実テキスト）', () => {
    const doc = `# 機能要件

- [F-02] ビートマップ共有
  - 入力: BeatMapとfingerprint(SHA-256)。
  - 処理: サーバーが保存し、同一fingerprintは再利用する。
  - 出力: beatmapId。

# 受け入れ基準

- [F-02] Given 同一fingerprint When 2回目に登録 Then 同じbeatmapIdが返る
`;
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  for (const alg of ['AES-256', 'HMAC', 'bcrypt', 'JWT', 'base64']) {
    test(`${alg} も連携先に数えない`, () => {
      const doc = `# 機能要件

- [F-01] 保存
  - 入力: Slackのトークン(${alg})
  - 出力: 保存結果

# 受け入れ基準

- [F-01] Given Slack When 保存 Then 暗号化されて保存される
`;
      expect(findUncoveredInputs(doc)).toEqual([]);
    });
  }

  test('文書が空でも落ちない', () => {
    expect(findUncoveredInputs('')).toEqual([]);
    expect(findUncoveredInputs('# 概要\n\nなにもない\n')).toEqual([]);
  });
});

describe('括弧内の扱い', () => {
  // 実測 2026-10-18: 生成器が書いた
  // 「Googleアカウント（Firebase Authentication のGoogleプロバイダのみ）」で
  // google / firebase / authentication を3つの連携先と誤読し、不備の無い文書を
  // spec ゲートが拒否した。括弧は「どう」を説明しており「何を」を列挙していない。
  test('区切りの無い括弧は修飾であって列挙ではない', () => {
    const doc = `# 機能要件

- [F-01] ログイン
  - 入力: Googleアカウント（Firebase Authentication のGoogleプロバイダのみ）
  - 出力: セッション

# 受け入れ基準

- [F-01] Given 未ログイン When Googleでログイン Then セッションが作られる
`;
    expect(findUncoveredInputs(doc)).toEqual([]);
  });

  test('区切りを含む括弧は列挙なので引き続き検出する', () => {
    const doc = `# 機能要件

- [F-01] 取り込み
  - 入力: 連携先(Slack、Gmail、Drive)
  - 出力: 正規化済みメッセージ

# 受け入れ基準

- [F-01] Given Slack When 取り込む Then 正規化される
`;
    const found = findUncoveredInputs(doc);
    expect(found).toHaveLength(1);
    expect(found[0].covered).toEqual(['slack']);
    expect(found[0].uncovered.sort()).toEqual(['drive', 'gmail']);
  });

  test('括弧の外に列挙があれば括弧の有無に関わらず検出する', () => {
    const doc = `# 機能要件

- [F-01] 取り込み
  - 入力: Slack、Gmail（いずれも読み取りのみ）
  - 出力: 正規化済みメッセージ

# 受け入れ基準

- [F-01] Given Slack When 取り込む Then 正規化される
`;
    const found = findUncoveredInputs(doc);
    expect(found).toHaveLength(1);
    expect(found[0].uncovered).toEqual(['gmail']);
  });
});
