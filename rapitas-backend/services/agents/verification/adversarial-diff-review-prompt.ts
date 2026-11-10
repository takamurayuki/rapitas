/**
 * adversarial-diff-review-prompt
 *
 * The judge prompt for the adversarial diff review — what a juror is asked to
 * decide, what is outside its jurisdiction, and the JSON shape it must reply
 * in. Pure text assembly; no I/O, no verdict logic (see
 * adversarial-diff-review-verdict.ts).
 */

/** Reason prefixes a juror uses for notes that must NOT drive the verdict. */
export const NON_VERDICT_REASON_RE = /^\s*(?:要確認|管轄外)\s*[:：]/;

/** Max characters of the task description shown to the judge. */
const MAX_DESCRIPTION_CHARS = 4000;

function bulletList(items: string[] | undefined): string | null {
  const list = (items ?? []).map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list.map((s) => `- ${s}`).join('\n') : null;
}

/**
 * Build the judge prompt. Pure and unit-testable.
 *
 * @param p - Task title/description/goals/constraints, plan, acceptance criteria, the diff text, and the measured verification (raw automated-verifier data, never the verifier's prose) / 採点入力
 * @returns The prompt body for the judge. / ジャッジ用プロンプト
 */
export function buildDiffReviewPrompt(p: {
  taskTitle: string;
  taskDescription?: string | null;
  goals?: string[];
  constraints?: string[];
  planContent: string;
  acceptanceCriteria: string[];
  diffText: string;
  /** Rendered raw automated-verifier result; null/undefined = no measurement on record. */
  measuredVerification?: string | null;
  /** verify.md's own overall verdict line only (the claim, not its reasoning). */
  verifyClaim?: string | null;
}): string {
  const ac =
    p.acceptanceCriteria.length > 0
      ? p.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(明示的な受入基準なし — 計画の意図を基準にする)';
  const description = p.taskDescription?.trim()
    ? p.taskDescription.trim().slice(0, MAX_DESCRIPTION_CHARS)
    : '(説明なし)';
  const goals = bulletList(p.goals);
  const constraints = bulletList(p.constraints);
  const measured = p.measuredVerification?.trim()
    ? p.measuredVerification.trim()
    : '(実測データなし — この節を根拠にした指摘はしない)';
  const claim = p.verifyClaim?.trim() ? p.verifyClaim.trim().slice(0, 300) : '(記載なし)';
  return `あなたはシニアコードレビュアーです。下記タスクの「最終差分」が要件を満たすか、**粗探しをする姿勢で**厳しく評価してください。実装者の自己申告は信用せず、差分そのもの（と下の実測データ）だけを根拠に判断します。

## タスク
${p.taskTitle}

### 説明
${description}
${goals ? `\n### 目的 (goals)\n${goals}\n` : ''}${constraints ? `\n### 制約 (constraints)\n${constraints}\n` : ''}
## 計画 (plan.md)
${p.planContent.slice(0, 6000) || '(計画なし)'}

## 受入基準
${ac}

## 最終差分 (git diff)
\`\`\`diff
${p.diffText}
\`\`\`

## 自動検証の実測データ（サーバーが worktree で実行した lint / 型 / テスト等の生の結果）
${measured}

## verify.md の自己申告（総合判定の行のみ）
${claim}

## 評価観点（ルーブリック）
- 要件充足: 各受入基準/計画の意図を実際に満たしているか（未実装・部分実装・的外れを検出）
- 正しさ: 明確なバグ・ロジック誤り・エッジケース未処理・型/契約違反
- 安全性: 機密情報の混入、危険な操作、インジェクション等
- 範囲: 計画外の不要・破壊的変更が混ざっていないか
- 省略の扱い: 差分に「変更ファイル一覧」がある場合、その一覧が変更の全量。[省略]マーカーで本文が切れているファイルを「未実装」と断定しない（表示上の制約であり、実装の欠落ではない）
- **未変更の扱い**: 変更ファイル一覧に現れないファイルは「このタスクが変更しなかった」ことだけを意味し、「目的の状態にない」ことは意味しない。**既に目的の状態にあったため変更が不要だった**可能性が常にある。同様に、ファイルがディレクトリ配下へ移り barrel で再エクスポートされた場合、それを参照する import 文字列は変わらないのが正常であり、import が不変であることは移動していない根拠にならない。差分外のファイルが未完了だと述べる場合は「要確認:」に留め、verdict には反映しないこと

## 管轄（あなたが判定してよい欠陥の範囲 — 厳守）
- **機械検出可能な欠陥の「推測」は管轄外**: コンパイルエラー・型エラー・テスト失敗の«可能性»を fail の根拠にしない。それらは決定的ゲート (lint / tsc / テスト実行) が別途実測しており、実在すればそちらが確実に検出する。あなたの役割は機械ゲートが検出**できない**欠陥（要件の取り違え・設計上の誤り・意味的なバグ・セキュリティ）に集中すること。
- **例外（実測との矛盾は指摘してよい）**: 上の「自動検証の実測データ」に**実測の失敗**（❌ のチェック）が出ているのに、verify.md の自己申告が成功を主張している場合、その矛盾は指摘してよい。evidence には実測データの該当チェック名と自己申告の文言を書く。実測データが無い・すべて合格・対象外のときに、失敗を推測して指摘しないこと。
- **差分に写っていないコードの内部仕様を一般常識で推測して fail にしない**: 共有コンポーネントの props 契約や既存 API の挙動など、このリポジトリ固有の実装は世間一般のライブラリ (shadcn / MUI 等) と同じとは限らない。計画や差分内に「実装確認済み」と根拠付きで記載があるならそれを尊重する。diff 外への疑義は reasons に「要確認:」プレフィックス付きで記録してよいが、**diff 内に矛盾の証拠がない限り、それだけを理由に verdict を fail にしない**。
- **ワークフロー成果物 (research.md / plan.md / verify.md) は git 差分に絶対に現れない**: これらはリポジトリ内のファイルではなく WorkflowFile テーブルの行として保存される。したがって受入基準が「〜が research.md に記録される」「〜を verify.md に記載する」と述べている場合、**それが差分に見当たらないことを fail の根拠にしてはならない**。その種の基準は本レビューの管轄外であり、別のバリデータが成果物本体に対して検証する。あなたが判定するのは差分に現れるコード変更だけ。該当基準は「管轄外」として reasons に残し、verdict には反映しないこと。
- **差分だけでは原理的に判定できない受入基準も管轄外**: (a) 稼働環境での実測・再計測・UI での確認・CI の実行結果・実 DB との照合、(b) 調査結果や判定根拠の文書化（ログ出力箇所の特定、欠陥か正常動作かの判定理由 — research.md / verify.md に書かれる種類のもの）、(c) 他タスクや実行時状態の変化（「タスク#N が次の状態へ遷移する」「遷移が 0 回になる」「インシデントが再発しない」）。これらは reasons に「管轄外: 受入基準N は差分では判定できない（実測系 / 文書化系 / 実行時状態系）」と 1 件ずつ残し、verdict には反映しない。verdict を fail にしてよいのは、差分に写っているコードに要件の取り違え・未実装・欠陥が**見える**場合だけ。すべての reasons が「要確認:」「管轄外:」だけになるなら verdict は "pass"。

## 出力（厳守）
**JSONオブジェクトのみ**を出力してください（前置き・コードフェンス不要）:
{"verdict":"pass"|"fail","severity":0-100,"findings":[{"severity":"blocker"|"major"|"minor","criterion":"受入基準N（該当する場合のみ）","summary":"何が問題か1文で","evidence":"根拠: ファイル:行 または差分の該当箇所の引用","repro":"再現手順（分かる場合のみ）"}]}
- 指摘は findings に1件ずつ書く。問題がなければ findings は空配列。
- severity の基準: blocker＝受入基準を満たさない・明確なバグ・セキュリティ問題で、このまま出せない。major＝要件の一部未達や意味的な欠陥で修正が必要。minor＝軽微な改善・好みの問題（修正を要求しない）。
- **evidence は必須**。差分の中の具体的な箇所（\`path/to/file.ts:42\` か、差分行の引用）を書く。差分に根拠を示せない疑義は evidence を空にし、summary を「要確認:」で始める（判定には使われず、記録だけ残る）。「管轄外:」の基準も同様に summary の先頭に付けて記録する。
- verdict は findings と一致させる: evidence 付きの blocker か major が1件でもあれば "fail"、それ以外（minor・要確認・管轄外だけ、または指摘なし）は "pass"。
- 各 finding の criterion には、対応する受入基準があれば「受入基準N」を書く（基準に紐づかない懸念は省略可）。summary の文頭に「受入基準N:」を付けてもよい。`;
}
