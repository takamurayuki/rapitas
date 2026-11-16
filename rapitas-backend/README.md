# rapitas-backend

Elysia + Bun + Prisma ORM で構築されたRapitasのバックエンドAPI。データベースは Web 版が PostgreSQL、デスクトップ版が SQLite (`DATABASE_URL` が `file:` で始まると SQLite。Prisma Client は `generated/prisma-postgres` と `generated/prisma-sqlite` に別々に生成される)。

## セットアップ

```bash
# 依存関係のインストール
bun install

# データベースのセットアップ
bunx prisma db push
bun run db:generate

# 開発サーバー起動 (scripts/dev.ts: 起動時に db push + generate を自動実行)
bun run dev
```

デスクトップ (SQLite) で動かす場合はリポジトリルートから `cd rapitas-desktop && node scripts/dev.js` を使う。

## 主要API

### タスク管理

- `GET /tasks` - タスク一覧取得
- `POST /tasks` - タスク作成
- `GET /tasks/:id` - タスク詳細取得
- `PATCH /tasks/:id` - タスク更新
- `DELETE /tasks/:id` - タスク削除

### エクスポート/インポート

- `GET /export/tasks/json` - タスクをJSON形式でエクスポート
- `GET /export/tasks/csv` - タスクをCSV形式でエクスポート
- `GET /export/backup` - 全データのフルバックアップ
- `GET /export/calendar/ical` - iCalendar形式でエクスポート（Google Calendar等と互換）
- `POST /import/tasks` - JSONからタスクをインポート
- `POST /import/tasks/csv` - CSVからタスクをインポート
- `POST /import/restore` - バックアップからリストア

### エージェント

- `POST /tasks/:id/execute` - タスクに対してAIエージェントを実行 (`routes/agents/execution/routes/execute-route.ts`)
- `GET /approvals` - 承認待ちリスト
- `POST /approvals/:id/approve` - 承認
- `POST /approvals/:id/reject` - 却下

### スケジュール

- `GET /schedules` - スケジュール一覧
- `POST /schedules` - スケジュール作成
- `GET /pomodoro/active` - アクティブなポモドーロセッション
- `POST /pomodoro/start` - ポモドーロ開始

## APIドキュメント

開発サーバー起動後、以下のURLでSwagger UIを確認できます：

- http://localhost:3001/api/docs

## テスト

```bash
bun test
```

## 環境変数

`.env.example`を参照してください。
