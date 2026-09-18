# 非公開評価セット（Private Evaluation Set）

`docs/autonomy-audit-2026-09-06.md` P1「Rapitas 専用の非公開評価セットと故障注入E2Eを整備する」の再実装（旧task873/PR#610はdevelopから327コミット乖離・CI失敗により失効しクローズ済み。実ファイルは取得不能なため、本ドキュメントのみを一次情報として再設計している）。

## 目的

自律エージェントの受入率・誤完了率・回帰率を継続測定するための、学習ループから隔離された評価専用データセットとランナーを提供する。既存の `scripts/eval-gates.ts`（ワークフローゲートの決定的関数評価）とは責務が異なり、置き換えるものではない。

## 「非公開」の意味

リポジトリを非公開にすることではない。学習ループ・プロンプト改善・自律実行の入力経路から明示的に除外される専用ディレクトリ（`rapitas-backend/eval/private-set/`）にケースを配置することで、評価対象のタスクがエージェントの学習データとして再利用されない状態を指す。`services/self-learning/` 配下のコードはこのディレクトリを参照してはならない（`services/self-learning/__tests__/eval-set-isolation.test.ts` が静的に保証する）。

## 分類方針

過去の実タスクを以下5カテゴリに分類する。

| カテゴリ | 内容 |
| --- | --- |
| バグ修正 | 既存の不具合を修正したタスク |
| 機能追加 | 新規機能を実装したタスク |
| 調査のみ | コード変更を伴わない調査・結論タスク |
| 複数サービス変更 | frontend/backend/desktop等、複数レイヤーにまたがる変更 |
| 失敗復旧 | 一度失敗・差し戻しを経て完了したタスク |

## ケース数方針

最終目標は30〜50件。本タスクでは `rapitas-backend/scripts/eval-collect-cases.ts` による自動収集結果を人手でレビューし、初期10件を `rapitas-backend/eval/private-set/cases/` に導入する。残りは継続拡充中であり、未達ではなく計画された段階的導入である。

## ケーススキーマ

```json
{
  "id": "string (一意)",
  "category": "bug-fix | feature | investigation-only | multi-service | failure-recovery",
  "taskDescription": "string（元タスクの説明）",
  "initialFiles": ["string（変更対象になったファイルの相対パス）"],
  "acceptanceCheck": "string（合否判定に使うシェルコマンド）",
  "expectedOutcome": "fail-to-pass | pass-to-pass"
}
```

- `fail-to-pass`: 修正前は失敗し、修正後に通過することを期待する受入テスト。
- `pass-to-pass`: 既存の合格状態が壊れないことを期待する回帰防止テスト。

## 学習ループからの除外

- ケース本体は `rapitas-backend/eval/private-set/cases/*.json` に配置する（`.gitignore` はしない）。
- `services/self-learning/` 配下のいずれのファイルも `eval/private-set` という文字列/パスを参照してはならない。違反は `eval-set-isolation.test.ts` で検出する。

## 実行方法

```bash
bun run eval:private-set
```

`rapitas-backend/scripts/eval-runner.ts` が `eval/private-set/cases/*.json` を読み込み、各ケースのスキーマを検証したうえで `acceptanceCheck` を実行し、fail-to-pass/pass-to-pass の集計結果を `eval-gates.ts` と同型のグループ単位pass/fail表示 + 非ゼロexit codeで出力する。ケースが0件の場合もエラー終了せず「0件」を明示してexit code 0で終了する。

## 現在の導入状況

| 項目 | 値 |
| --- | --- |
| 初期導入件数 | 10件 |
| 目標件数 | 30〜50件 |
| ステータス | 継続拡充中 |

## 関連ファイル

| ファイル | 役割 |
| --- | --- |
| `rapitas-backend/scripts/eval-collect-cases.ts` | DBの `Task` からケース候補を自動抽出 |
| `rapitas-backend/scripts/eval-runner.ts` | 評価セット実行ランナー |
| `rapitas-backend/eval/private-set/cases/*.json` | 評価ケース本体 |
| `rapitas-backend/services/self-learning/__tests__/eval-set-isolation.test.ts` | 学習ループからの隔離を保証する静的ガード |

## 記憶想起の遮断（RAPITAS_EVAL_MODE）

現行の `eval-runner.ts` は `acceptanceCheck` をシェルコマンドとして直接実行するのみで、CLIエージェント/ワークフローオーケストレーターを起動しない。そのため、KB検索・エピソード想起（`services/workflow/workflow-memory-context.ts` の `buildMemoryContext`）を経由する実行経路は現状のbaselineシナリオには存在しない。

一方で、将来 `eval-runner.ts` に実エージェント呼び出しが追加された場合に備え、`buildMemoryContext` の先頭で `RAPITAS_EVAL_MODE === 'true'` をチェックし、KB検索・失敗エピソード想起の両方を実行せず即座に空文字を返すガードを実装済みである（`createPullRequest` の既存のPR作成モック化ゲートと同一の環境変数・同一の厳密文字列比較 `'true'` を使う）。

| 項目 | 状態 |
| --- | --- |
| フラグ設定経路 | `scripts/eval-runner.ts` / `scripts/fault-injection-e2e.ts`（値は文字列 `'true'`。タスク記述にある `RAPITAS_EVAL_MODE=1` という表記は誤り） |
| 想起遮断の実装範囲 | `buildMemoryContext()` 全体（KB検索 + 失敗エピソード想起）。researcher/planner/implementer/verifierの4コンテキストに自動的に波及する |
| 遮断の粒度 | 実行全体（`RAPITAS_EVAL_MODE` が立っている間は全タスクの想起を遮断）。`EvalCorpusTask.sourceTaskId` 単位の選択的遮断ではない — 当該Prismaモデルは現行スキーマに存在せず、書き込み元となる実エージェント実行ハーネスも未実装のため導入していない |
| 既知の限界 | baselineシナリオで実エージェントに評価コーパスタスクを解かせる経路自体が未実装のため、記憶想起遮断の前後比較によるfail-to-pass率の実測改善はできない。将来 `eval-runner.ts` に実エージェント呼び出しが追加された時点で、本ガードがそのまま有効になる |
