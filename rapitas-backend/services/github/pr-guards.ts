/**
 * PR Guard Utilities
 *
 * PR操作系エンドポイントの入力値を事前チェックするユーティリティ。
 * prNumber整合性(422)とstate事前チェック(409)を担当する。
 * set.status の設定は呼び出し側 (github.ts) が行う。
 */

/** checkPrActionable が返す違反オブジェクト。呼び出し側で set.status に設定すること。 */
export interface PrGuardViolation {
  status: 422 | 409;
  body: { success: false; error: string };
}

/**
 * PR が指定操作を実行可能な状態かを検査する純粋関数。
 *
 * @param pr - prNumber と state を持つ PR レコード
 * @param opts.operationLabel - エラーメッセージ用の操作名（例: 'base変更'）
 * @param opts.requireOpen - true の場合 state !== 'open' を 409 で弾く / コメント等は false を渡す
 * @returns 違反があれば PrGuardViolation、問題なければ null
 */
export function checkPrActionable(
  pr: { prNumber: number; state: string },
  opts: { operationLabel: string; requireOpen: boolean },
): PrGuardViolation | null {
  // NOTE: DB の Int 型通常値は通過する。0 や負値、非整数は不正な prNumber として弾く。
  if (!Number.isInteger(pr.prNumber) || pr.prNumber <= 0) {
    return {
      status: 422,
      body: {
        success: false,
        error: `不正なPR番号です (prNumber=${pr.prNumber})。${opts.operationLabel} を実行できません`,
      },
    };
  }

  // NOTE: DB 運用は小文字 ('open'/'merged'/'closed') で統一されている (pr-read.ts:31)。
  if (opts.requireOpen && pr.state !== 'open') {
    return {
      status: 409,
      body: {
        success: false,
        error: `PRがopen状態ではないため ${opts.operationLabel} を実行できません (state=${pr.state})`,
      },
    };
  }

  return null;
}
