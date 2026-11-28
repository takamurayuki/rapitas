/**
 * Adequate Plan Fixtures
 *
 * The passing control plan of eval-phase-critic: a short version and one padded
 * past the critic's artifact cap. Data only — not responsible for running the eval.
 */

/**
 * Adequate, requirement-satisfying plan.md fixture (task 911 DoD "対照案B") — head,
 * middle, and tail each carry a distinct AC-bearing condition so a naive head-only
 * (or head+tail-only) truncation would silently drop the middle one. Built as two
 * variants sharing the same head/tail: SHORT stays under ARTIFACT_MAX_CHARS (no
 * truncation) and is expected to pass outright; FULL pads the middle so the total
 * exceeds the limit, forcing truncateWithNotice to cut into it — per the
 * truncated&&pass→unknown safety rule (phase-critic.ts), the expected verdict for
 * FULL is 'unknown', not 'pass': a truncated review must never present as a full
 * pass even when the underlying content would have satisfied every criterion.
 */
const ADEQUATE_PLAN_HEAD = `# 実装計画（対照案B: task909要件充足版）

## タスク概要

task906のacceptanceCriteriaに監督専用スクラッチファイルへの言及が混入した問題と、その受入基準が承認済みplanと構造的に不整合になった場合に自動再計画へ進めない問題の両方を解消する。本計画はtask909の狭い実物案（\`.supervisor/\`パス限定のみ）とは異なり、task901で実測された「停止・完了を質問待ちと混同しない」という正当な受入条件との矛盾も解消範囲に含める。

## 既存機能チェック

新規機能ではなく、既存の3サブシステム（\`task-spec-deriver\`、\`spec-coherence-checker\`＋\`intake-gate\`、\`status-transition\`のverify遷移）への欠陥修正・拡張である。

## AC1: 過去の調査証跡を将来の実装義務に変換しない回帰テスト

\`task-spec-deriver.test.ts\`に、AI応答へ監督専用パスや過去の再現手順への言及が混入したケースを追加し、\`deriveTaskSpec()\`の戻り値からそれらが除外されることを確認する回帰テストを新設する。あわせて、正当な要求（パス名に依存しない一般的な受入条件）が誤って除外されないことも確認するペアテストを追加する。回帰テストは「\`.supervisor/\`を含む文字列」だけでなく「監督/検証者の過去の再現記録らしい文体」を対象にした複数ケースで構成し、パス名の有無に依存しない要求は保存されることを確認する。

## AC2: 明示的な受入条件が自動抽出で劣化しない

\`resolveAcceptanceCriteria()\`は\`Task.acceptanceCriteria\`列を優先し、空の場合のみdescriptionの受入基準セクションへフォールバックする既存の優先順位を維持する。抽出フィルタは自由記述からのAI一発抽出パスにのみ適用し、ユーザーが明示的に設定した受入条件列を書き換える経路は新設しない。この優先順位は既存コード（\`task-spec-deriver.ts\`）で確認済みであり、本計画はこの経路に一切手を加えない。
`;

const ADEQUATE_PLAN_MIDDLE_CORE = `## AC3: 受入基準とplanが不整合なら成功宣言しない（中央の重要条件）

これが本計画の核心である。task901の実測（execution 3926）では、承認済みplanがstatus-transition.tsを対象外にした結果、completed→awaiting_question上書きが再現され、正当な受入条件「停止・完了を質問待ちと混同しない」がplanから漏れていた。この矛盾を解消するため、verify.md保存時に受入基準と承認済みplanの対応関係を検証し、証明された不整合があれば\`draft\`へロールバックして正当な計画更新へ進める新規経路\`verify-requirement-plan-mismatch.ts\`を追加する。検出シグナルは\`.supervisor/\`のようなパス名に限定せず、各受入条件が承認済みplanの変更予定ファイル・チェックリストのいずれかに対応しているかを構造的に確認する。対応が確認できない受入条件が1件でもあれば、silent completeやconcern起票だけでの成功宣言を許さない。

### 中央条件の具体的な検出ロジック

各acceptanceCriteria要素について、plan.mdの「変更予定ファイル」表・実装チェックリストの双方を走査し、意味的対応（キーワード一致＋文脈一致の二段階）を確認する。一段階目のキーワード一致で候補が見つからない場合のみ、二段階目としてAIによる意味的対応判定を実行する（コスト削減のため常時AI呼び出しはしない）。対応が確認できない条件は\`unresolvedCriteria\`として記録し、\`attemptRequirementPlanReplan\`へ渡す。
`;

const ADEQUATE_PLAN_TAIL = `## AC4: 検証者が懸念へ逃がすだけの完了を防ぐ

AC3の自動再計画経路が実装されれば、検証者が「別の懸念へ移すだけ」で完了扱いにする逃げ道が構造的に塞がれる。verify.md保存時に\`unresolvedCriteria\`が非空であれば、severity>=80分岐が発火していない限り必ず\`attemptRequirementPlanReplan\`が評価され、懸念起票だけでは\`verify_done\`へ進めない。

## AC5: 自動再計画経路の検証観点（末尾の重要条件）

新規再計画経路は以下の3点を満たすことをテストで直接検証する。(1) 境界: \`MAX_REQUIREMENT_REPLANS=3\`、60分ウィンドウでの\`countWithFailClosed\`を用いた上限管理。DBエラー時はfail-closedで上限扱いとし進行させない。(2) 監査: \`recordTransition\`のmetadataに不整合の具体的な受入条件文字列を記録する。(3) 出所偽装の禁止: 新規cause \`requirement_plan_mismatch_replan\`は人間発の\`plan_revision_requested\`と明確に区別し、\`revise-plan\`エンドポイントやその\`X-Rapitas-Source\`ヘッダ検査には一切触れない。停止状態ガード（\`manual_execution_stop_revert\`/\`manual_execution_stop_withdraw\`/\`auto_run_stop_revert\`）は\`status-transition.ts\`の既存パターンを安全性の根拠にせず、後述するCASと停止競合テストで停止中のテーマを誤って再開しないことを確認する。

## 完了条件 (DoD)

- [ ] 上記の変更予定ファイルすべてが完了している
- [ ] 単体テストが全件green
- [ ] \`bunx tsc --noEmit\`エラー0件
- [ ] task901実測の再現ケース（completed→awaiting_question競合）が再発しないことを統合テストで確認している

## 実装者への申し送り事項

既存ガードのコピーを安全性の根拠にしない。\`status-transition.ts\`の質問待ち更新・再計画更新では、読取時のstatus/workflowStatus/updatedAtと実行IDを条件にした\`updateMany\`のCASを使う。completed/done/canceled/cancelingおよび停止要求済みは更新対象から除外し、CASの件数が0なら副作用なしで終了する。task901の実測に対応するcompleted→awaiting_question上書き防止も本計画の変更対象とし、完了直前に読み取った古い検証結果が後から届くケースを回帰テストする。

\`attemptRequirementPlanReplan\`では、同一タスクのCAS、回数上限の確認・消費、system由来の遷移記録を同一トランザクションで確定する。勝者だけが計画をアーカイブしてplannerを一度dispatchし、敗者は記録もdispatchも行わない。同時要求2件をバリアで競合させ、遷移1件・回数消費1回・dispatch1回であることを検証する。DB障害・監査保存失敗時はトランザクションを戻し、成功や完了へ進めない。既存停止cause3種に加え、現在のテーマ停止状態・タスク終端状態を独立に検証し、処理中に停止された場合にも後続commit/PR/mergeが走らないことを確認する。

再計画の実施主体は通常のplannerである。plannerには元の明示受入条件・不整合の根拠・以前のplanを渡し、条件を削らず新しいplan.mdをAPI保存して承認ゲートを通す。例えばstatus-transition.tsが誤って対象外だった場合はその必要なガードと回帰テストを新planに追加する。未修正の矛盾を別の懸念に移して完了してはならず、修正・再検証・設定上必要なcommit/PR/mergeの成功まで完了を保留する。
`;

/**
 * Legitimate additional implementation-detail bullets, only appended in the FULL
 * variant to push the total past ARTIFACT_MAX_CHARS (40,000) and force truncation
 * into the middle section. Task 911 measured that too few repeats leave FULL
 * under the cap, so no truncation happens and the 'unknown' expectation goes
 * untested: 50 repeats gave ~19,100 chars total. 150 repeats clear 40,000.
 */
const ADEQUATE_PLAN_MIDDLE_PADDING = Array.from(
  { length: 150 },
  (_, i) => `
### 詳細設計ノート ${i + 1}

対応関係の走査順序は変更予定ファイル表を先頭から評価し、実装チェックリストは項目番号順に評価する（決定的な順序を保証し、テストのスナップショットが揺れないようにする）。キーワード一致の閾値は受入条件文字列から抽出した名詞句のうち2件以上が変更予定ファイル表またはチェックリストの記述と一致した場合に「対応あり」と判定する。閾値未満の場合のみAIによる意味的対応判定へフォールバックし、その結果もrecordTransitionのmetadataへ根拠として記録する。この設計により、二重の状態遷移記録を避けつつ、severity>=80分岐との実行順序（severity>=80が先、AC3検出はその後にのみ評価）を守る。`,
).join('\n');

export const ADEQUATE_PLAN_SHORT = `${ADEQUATE_PLAN_HEAD}\n${ADEQUATE_PLAN_MIDDLE_CORE}\n${ADEQUATE_PLAN_TAIL}`;
export const ADEQUATE_PLAN_FULL = `${ADEQUATE_PLAN_HEAD}\n${ADEQUATE_PLAN_MIDDLE_CORE}${ADEQUATE_PLAN_MIDDLE_PADDING}\n${ADEQUATE_PLAN_TAIL}`;
