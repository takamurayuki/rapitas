# AGENTS.md

このリポジトリで作業する AI エージェント向けの共通運用ガイドです。Codex、Gemini、Claude など、Claude 固有の `CLAUDE.md` を読まない実行環境でも同じ前提で動けるようにしています。

## 基本方針

- ユーザーへの説明は原則として日本語で行う。
- 変更前に既存コード、テスト、設定を確認し、周辺の設計に合わせて最小限の修正を行う。
- ユーザーや他エージェントの未コミット変更を勝手に戻さない。作業前後に `git status` を確認する。
- 仕様が曖昧でも、リポジトリから妥当な前提を読み取れる場合は実装まで進める。
- シークレット、API キー、認証情報をリポジトリに保存しない。デスクトップ版の認証情報/API キーは OS keychain を使う。

## プロジェクト構成

- `rapitas-frontend/`: Next.js + TypeScript + Tailwind CSS。Web UI。
- `rapitas-backend/`: Bun + Elysia + Prisma。Web 版は PostgreSQL、デスクトップ版は SQLite。
- `rapitas-desktop/`: Tauri 2 desktop shell。`npm run tauri` は SQLite 版バックエンドを使う。
- `rapitas-manager/`: 管理系ツール。
- `.claude/`, `docs/`: Claude 向け運用資料や設計メモ。

## 重要な禁止事項

- `rapitas-backend` の Bun サーバー、特に `3001` 番ポートのプロセスを勝手に kill しない。エージェント実行や API 通信に使われる。
- `prisma generate` や `prisma db push` を手動実行しない。開発サーバー起動スクリプトが必要なタイミングで実行する。スキーマ変更後はユーザーにサーバー再起動を依頼する。
- 自動化が未完了のタスクを `completed` や `done` として扱わない。
- Claude 専用の CLI 機能やファイルが Codex/Gemini でも存在すると仮定しない。

## よく使う検証

作業範囲に応じて必要なものだけ実行する。

```powershell
cd rapitas-backend
bunx tsc --noEmit
bun test --isolate <test-file>
```

```powershell
cd rapitas-frontend
pnpm test -- --run
pnpm exec tsc --noEmit
pnpm exec prettier --check .
```

```powershell
cd rapitas-desktop
npm run tauri
```

CI/CD や配布ビルドでは、OS ごとの依存関係に注意する。Linux の Tauri build では ALSA などの system package が必要になることがある。

## データベース方針

- Web 版: PostgreSQL。
- Tauri desktop 版: SQLite。
- 実行ログはファイルベースで扱う。
- 認証情報/API キーは OS keychain を使い、DB や平文ファイルに保存しない。
- PostgreSQL から SQLite へ移行する場合は、専用移行スクリプトを使い、実行前にテスト DB/一時 DB で検証する。

## AI エージェント実行ワークフロー

ワークフローファイルは原則として直接ファイル作成せず、バックエンド API 経由で保存する。

- `GET /workflow/tasks/{taskId}/files`
- `PUT /workflow/tasks/{taskId}/files/{fileType}`
- `POST /workflow/tasks/{taskId}/approve-plan`
- `PUT /workflow/tasks/{taskId}/status`

標準的な状態遷移:

1. `research.md` 保存後: `research_done`
2. `plan.md` 保存後: `plan_created`
3. Plan 承認後: `plan_approved`
4. 実装開始後: `in_progress`
5. `verify.md` 保存後: `verify_done`
6. 必要な commit / PR / merge などの完了ゲート通過後: `completed` またはタスク `done`

`verify.md` を保存しただけでタスクを完了扱いにしてはいけない。`autoCommit`、`autoCreatePR`、`autoMergePR` が有効な場合は、要求された最終ステップまで成功してから完了にする。

## 停止・キャンセル

停止ボタンやキャンセル要求を扱う実装では、以下をすべて満たすこと。

- DB 上の実行状態を canceling/canceled 系へ遷移させる。
- キューに残っているサブタスクを停止対象にする。
- 実行中 CLI プロセスと child process に終了シグナルを送る。
- 停止後に後続の自動 commit / PR / merge を実行しない。
- ログには「停止要求を受けた」「プロセスを停止した」「停止後の状態」を残す。

## モデル選択と CLI 差分

- タスクの難度、コスト、利用可能プロバイダー、フォールバック設定を見てモデルを選ぶ。
- 設定上のモデル名と CLI が実際に報告するモデル名が異なる場合は、実行結果に記録された `modelName` を優先して診断する。
- Codex CLI は通常の進捗や JSONL を stderr に出すことがある。stderr があるだけで失敗扱いにせず、exit code、構造化イベント、最終結果を合わせて判定する。
- Gemini CLI は `GEMINI_API_KEY` または `GOOGLE_API_KEY`、あるいは OAuth/project 設定が必要になる。未設定時は環境不備として扱い、別モデルへのフォールバック可否を確認する。
- Claude 固有の `CLAUDE.md` だけに依存せず、この `AGENTS.md` と実行時プロンプトで共通制約を渡す。

## Git / PR

- 作業開始時にブランチと dirty state を確認する。
- git worktree を使う場合は、各タスクの作業ディレクトリを分離し、親タスク/サブタスク間の依存を明示する。
- コミットは変更範囲が検証済みになってから行う。
- PR を作成する場合は `gh` を使い、PR URL をログとタスク結果に残す。
- PR 作成前にタスクを完了扱いにしない。

## 変更時の注意

- 共有オーケストレーター、実行状態、タスク完了ゲート、CLI process runner、ログ処理を変更した場合は、停止処理・エラー処理・サブタスク処理・PR 完了判定を必ず確認する。
- フロントエンドの状態表示を変える場合は、バックエンドの実状態と UI 表示がずれないようにする。
- テストが落ちた場合、テスト期待値だけでなく実装の状態遷移が正しいかを先に確認する。
