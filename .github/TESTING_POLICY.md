# Rapitas テスト戦略ポリシー

> **対象**: `.github/workflows/test-lint.yml` / `rapitas-backend/scripts/ci-gate-tests.txt`
> **更新時**: CI 構成を変更したら必ずこのファイルも更新すること。

---

## 0. CI ゲートフレームワーク（Task #373 追加）

`rapitas-backend/scripts/` に宣言的ゲート管理フレームワークを導入した。

### 構成ファイル

| ファイル | 役割 |
| -------- | ---- |
| `scripts/ci-gates.ts` | **ゲートレジストリ**。型付き `GateEntry` 配列で全ゲートを一元宣言 |
| `scripts/run-gate.ts` | **汎用ランナー**。`bun scripts/run-gate.ts <gateId>` でゲートを実行 |
| `scripts/gate-manifest-parser.ts` | **共有パーサー**。`.txt` マニフェストの解析と drift 検証を提供 |
| `scripts/ci-gate-tests.txt` | バックエンドゲート（`backend-tests`）のファイルリスト |
| `scripts/sqlite-compat-tests.txt` | SQLite ゲート（`sqlite-tests`）のファイルリスト |

### 登録済みゲート

| Gate ID | 種別 | コマンド | 説明 |
| ------- | ---- | -------- | ---- |
| `backend-tests` | `test-suite` | `bun run test:ci` | バックエンドCIゲート（coverage + isolate） |
| `sqlite-tests` | `test-suite` | `bun run test:sqlite` | SQLite 互換ゲート（isolate, no coverage） |

### 新しいゲートの追加手順

```
1. scripts/ci-gates.ts に GateEntry を 1 件追加する
2. ゲート種別が 'test-suite' なら scripts/<name>.txt マニフェストも作成する
3. ローカルで bun scripts/run-gate.ts <newId> を実行してグリーンを確認する
4. develop へ push → CI グリーン → PR マージ
```

> **ゲート種別について**:
>
> - `'test-suite'`: `bun test` でマニフェストのファイルを実行する（現在実装済み）
> - `'command'`: `--check` 終了コード規約に従う任意コマンド（follow-up で実装予定）

---

## 1. Baseline 定義

**唯一の必須通過ゲート**: `test-backend` ジョブ

| 項目 | 内容 |
| ---- | ---- |
| 実行コマンド | `bun run test:ci`（= `bun scripts/run-gate.ts backend-tests`） |
| 実行モード | `bun test --coverage --isolate`（決定論的、プロセス分離） |
| ファイルリスト | `rapitas-backend/scripts/ci-gate-tests.txt`（単一情報源） |
| DB 依存 | PostgreSQL 必須（`test-lint.yml` の postgres service を利用） |
| 合否の扱い | **マージをブロックする**（hard-gate） |

### ゲートマニフェスト管理ルール

- ファイルの追加／削除は `ci-gate-tests.txt` のみを編集する。
  `test-lint.yml` の `test-backend` ステップを直接書き換えない。
- 追加前に `bun run test:ci` でローカルグリーンを確認してから追記する。
- 削除する場合はコメントアウトし、懸念バックログへ起票してから除外する。

---

## 2. 失敗ティア表

| ジョブ | ティア | マージへの影響 | 目的 |
| ------ | ------ | -------------- | ---- |
| `test-backend` | **hard-gate** | ブロックする | ゲートスイートの回帰を検出 |
| `test-sqlite` | **hard-gate** | ブロックする | SQLite 互換性の維持 |
| `lint` | **hard-gate** | ブロックする | TypeScript / ESLint / Prettier |
| `check-frontend` | **hard-gate** | ブロックする | フロントエンド型検査 + gate テスト |
| `rust-check` | **hard-gate** | ブロックする | Rust フォーマット / Clippy |
| `test-full-advisory` | **advisory** | ブロックしない | 全スイートの回帰を可視化 |
| `test-order-check` | **advisory** | ブロックしない | テスト順序依存を検出 |

> **advisory ジョブが赤になった場合**: マージは可能だが、Step Summary に失敗ファイルが
> 表示される。新規回帰と pre-existing 失敗の区別はエージェント側の `test-triage`
>（merge-base 比較）が担う。

---

## 3. 既存失敗の扱い

### CI 側（`test-full-advisory`）

- `test-full-advisory` は `continue-on-error: true` のため、full-suite の
  pre-existing 失敗は **マージをブロックしない**。
- 許容失敗リストファイルは新設しない（二重管理を避ける）。

### エージェント側（`test-triage`）

- エージェント検証ゲート（`services/agents/verification/test-triage.ts`）が
  **merge-base ワークツリーと比較**して新規失敗のみをブロックする。
- pre-existing 失敗は `test-baseline:<file>` の dedupKey で懸念バックログへ自動起票される。
- 環境変数 `RAPITAS_TEST_TRIAGE=1`（デフォルト ON）で有効。

### 記録（2026-08-17, task 600）

`agent-orchestrator.{delegation,lifecycle,state-and-events,stop}.test.ts` 4件の
stale mock（`startExecutionLeaseSweep` export 欠落）を修正した。full-suite が
恒常的に赤かった主因はこの4件であり、本修正が §6 昇格パスの
「20連続グリーン」カウントの起点となる。経緯と決定は
[ADR-0007](../docs/adr/0007-always-red-ci-gates-file-size-and-full-suite.md) を参照。

---

## 4. retrigger ポリシー

| シナリオ | 対応 |
| -------- | ---- |
| hard-gate がたまに失敗する（flaky 疑い） | GitHub UI の **"Re-run failed jobs"** で手動再実行 |
| 自動 retry アクション | **採用しない** — 本物の flaky を隠蔽し懸念バックログへの顕在化を妨げる |
| shuffle 失敗の再現 | `TEST_SHUFFLE_SEED=<run_number>` で同じシードを再現（`test-order-check` ログに出力） |
| flaky 確認後の対処 | 懸念バックログへ起票（`test-baseline:<file>`）→ 修正後にゲートへ追記 |

---

## 5. threshold 方針（カバレッジ閾値）

**現時点では閾値を設定しない（deferred）。**

### 理由

- ゲートスイートは全テストスイートの約 10% のみカバーしており、ゲートスイート単体の
  カバレッジ % は全体の健全性を正確に反映しない。
- 誤った閾値は偽の安心感を与えるか、不当にマージをブロックする。

### 閾値導入の条件（昇格条件）

1. `test-full-advisory` が develop で安定してグリーンになる（連続 10 runs 以上）。
2. ゲートスイートが全テストの 50% 以上をカバーするよう `ci-gate-tests.txt` が拡張される。
3. 上記 2 条件を満たした後、閾値（例: line coverage ≥ 70%）を別タスクで設定する。

---

## 6. ゲート昇格パス

新しいテストファイルをゲートスイートに追加して mandatory 化するまでの手順：

```
1. 対象テストファイルを ci-gate-tests.txt にコメントアウト状態で追記
2. bun run test:ci でローカルグリーンを確認
3. コメントを外して ci-gate-tests.txt を更新
4. develop へ push → test-backend グリーン → PR マージ
5. test-full-advisory が安定してグリーンになっていれば
   ゲートスイート全体の mandatory 化（カバレッジ threshold 導入）を検討
```

### test-full-advisory → hard-gate 昇格の基準

- advisory full-suite が develop で **20 連続グリーン** を達成する。
- 上記達成後、`test-full-advisory` の `continue-on-error: true` を外す PR を作成する。
- 達成状況は懸念バックログ（ラベル: `ci-advisory-escalation`）でトラッキングする。

---

## 関連ファイル

| ファイル | 役割 |
| -------- | ---- |
| `rapitas-backend/scripts/ci-gates.ts` | ゲートレジストリ（ゲート定義の単一情報源） |
| `rapitas-backend/scripts/run-gate.ts` | 汎用ランナー（`bun scripts/run-gate.ts <gateId>`） |
| `rapitas-backend/scripts/gate-manifest-parser.ts` | 共有パーサー（`.txt` 解析 + drift 検証） |
| `rapitas-backend/scripts/ci-gate-tests.txt` | backend-tests ゲートのファイルリスト |
| `rapitas-backend/scripts/sqlite-compat-tests.txt` | sqlite-tests ゲートのファイルリスト |
| `rapitas-backend/scripts/run-gate-tests.ts` | 後方互換 adapter（`bun run test:ci` の旧実装経由） |
| `rapitas-backend/scripts/parallel-test.ts` | 全スイートを並列実行（advisory ジョブで使用） |
| `rapitas-backend/scripts/shuffle-test.ts` | ランダム順序でテストを実行（order-check ジョブで使用） |
| `rapitas-backend/services/agents/verification/test-triage.ts` | エージェント側: merge-base 比較で新規失敗を検出 |
| `.github/workflows/test-lint.yml` | CI ジョブ定義 |
| `.github/CI_CD_SETUP.md` | CI 全体のセットアップガイド |
