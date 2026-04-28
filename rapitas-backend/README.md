# rapitas-backend

Elysia + Bun + Prisma ORM + PostgreSQL で構築されたRapitasのバックエンドAPI。

## セットアップ

```bash
# 依存関係のインストール
bun install

# データベースのセットアップ
bunx prisma db push
bun run db:generate

# 開発サーバー起動
bun run dev
```

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

- `POST /agents/execute` - AIエージェント実行
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

- http://localhost:3001/swagger

## テスト

```bash
bun test
```

## 環境変数

`.env.example`を参照してください。

This project was created using `bun init` in bun v1.2.10. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
