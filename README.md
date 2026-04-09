# Rapitas

AI-Powered 階層型タスク管理システム

Rapitasは、AI機能を統合した先進的なタスク管理システムです。Claude/OpenAI統合によるAIエージェント実行、リアルタイム同期、ポモドーロタイマー、そしてクロスプラットフォーム対応（Web + デスクトップ）を提供します。

## プロジェクト構成

```
rapitas/
├── rapitas-backend/    # バックエンド (Bun + Elysia + Prisma + AI統合)
├── rapitas-frontend/   # フロントエンド (Next.js 16 + React 19 + Tailwind v4)
├── rapitas-desktop/    # デスクトップアプリ (Tauri 2.x)
├── package.json        # ルートレベルの統合開発コマンド
└── [開発スクリプト]
```

## 🚀 クイックスタート

### 方法 1: 統合開発環境（推奨）

```bash
# Tauri統合開発環境（自動セットアップ + ホットリロード）
cd rapitas-desktop
node scripts/dev.js

# またはwatch mode
node scripts/dev.js --watch
```

**特長:**

- PostgreSQL接続チェック・自動修復
- Prismaスキーマ同期 (`db push --skip-generate`)
- Prisma Client自動生成
- バックエンド・フロントエンド同時起動
- Tauriデスクトップアプリ統合

### 方法 2: Web開発のみ

```bash
# 初回セットアップ
npm install

# プリフライトチェック + Web版開発サーバー起動
npm run dev
```

起動時に **プリフライトチェック** が自動実行され、以下を検証します：

- bun / pnpm / node のインストール確認
- `.env` ファイルの存在確認と `DATABASE_URL` の設定確認
- `node_modules` の存在確認
- ポート 3000 / 3001 の空き確認

バックエンドまたはフロントエンドのどちらかが起動に失敗した場合、もう一方も自動的に停止します（`--kill-others-on-fail`）。これにより、片方だけ起動してエラーになる事態を防ぎます。

```bash
# プリフライトチェックのみ実行
npm run check

# チェックをスキップして高速起動（2回目以降）
npm run dev:skip-check
```

### 方法 3: 個別起動（高度なユーザー向け）

> **注意**: 個別起動の場合、バックエンド（ポート3001）を先に起動してからフロントエンドを起動してください。フロントエンドのみの起動ではAPI通信がエラーになります。

```bash
# バックエンド（先に起動）
cd rapitas-backend
bun run dev

# フロントエンド（別ターミナル）
cd rapitas-frontend
pnpm run dev

# Tauriデスクトップアプリ（別ターミナル）
cd rapitas-desktop
npm run tauri
```

## 📌 アクセス URL

- **フロントエンド (Web)**: http://localhost:3000
- **デスクトップアプリ**: `rapitas-desktop/scripts/dev.js` 実行時に自動起動
- **バックエンド API**: http://localhost:3001
- **Prisma Studio** (DB管理): http://localhost:5555

## 🛠️ 利用可能なコマンド

### 🚀 開発環境コマンド

```bash
# 統合開発環境（推奨）
cd rapitas-desktop && node scripts/dev.js

# Web版開発サーバー（プリフライトチェック付き）
npm run dev

# プリフライトチェックをスキップして起動
npm run dev:skip-check

# プリフライトチェックのみ
npm run check

# バックエンドのみ
npm run dev:backend

# フロントエンドのみ
npm run dev:frontend

# Tauri統合開発をルートから起動
npm run dev:tauri          # 通常モード
npm run dev:tauri:watch    # ファイル監視付き

# 依存関係を一括インストール
npm run install:all
```

### 🗄️ データベース・Prismaコマンド

```bash
# Prismaスキーマ同期（本番環境）
cd rapitas-backend && npx prisma db push

# Prisma Client再生成
cd rapitas-backend && bun run db:generate

# マイグレーション実行（本番環境）
cd rapitas-backend && npx prisma migrate dev

# Prisma Studio起動（DB管理GUI）
cd rapitas-backend && bun run db:studio
```

### 📱 Tauriデスクトップアプリ

```bash
# デスクトップアプリ開発
cd rapitas-desktop && npm run tauri

# Tauriアプリのみ起動（開発サーバーなし）
cd rapitas-desktop && npm run tauri:only

# プロダクションビルド
cd rapitas-desktop && npm run build
```

### 🧪 テスト・品質管理

```bash
# 全テスト一括実行（バックエンド + フロントエンド並列）
npm run test:all

# 全リンター一括実行
npm run lint:all

# 個別実行
cd rapitas-backend && bun test
cd rapitas-frontend && pnpm test

# フロントエンド linting
cd rapitas-frontend && pnpm run lint

# フロントエンド フォーマット確認
cd rapitas-frontend && pnpm run prettier:check
```

## 📦 初期セットアップ

### 前提条件

- **Node.js**: v18以上
- **Bun**: 最新版 (`curl -fsSL https://bun.sh/install | bash`)
- **PostgreSQL**: v14以上（ローカル実行）
- **Git**: バージョン管理

### 🎯 自動セットアップ（推奨）

```bash
# 1. リポジトリクローン
git clone https://github.com/takamurayuki/rapitas.git
cd rapitas

# 2. 依存関係インストール
npm run install:all

# 3. 環境設定
# rapitas-backend/.env を作成し、DATABASE_URL を設定
cp rapitas-backend/.env.example rapitas-backend/.env

# 4. 自動初期化 + 開発サーバー起動
cd rapitas-desktop
node scripts/dev.js
```

**`dev.js`が自動実行する処理:**

- PostgreSQL接続検証・修復
- Prismaスキーマ同期 (`prisma db push --skip-generate`)
- Prisma Client生成 (`prisma generate`)
- バックエンド・フロントエンド同時起動
- ポートコンフリクト解消

### 📝 手動セットアップ（必要な場合のみ）

```bash
# 1. データベースセットアップ（初回のみ）
cd rapitas-backend
npx prisma migrate dev

# 2. Prisma Client生成
bun run db:generate

# 3. 開発サーバー起動
npm run dev  # または cd ../rapitas-desktop && node scripts/dev.js
```

## 🎯 主な機能

### 🤖 AI機能（NEW）

- **AIエージェント実行**: Claude・OpenAI統合による自動タスク実行
- **ワークフロー機能**: research → plan → implement → verify の構造化開発
- **スクリーンショット**: Playwright統合による画面キャプチャ
- **AI対話**: コンテキスト保持型チャット機能

### ✅ コアタスク管理

- **階層型プロジェクト管理**: プロジェクト → テーマ → タスク構造
- **カテゴリー・テーマ**: 色分け、アイコン、詳細管理
- **マイルストーン管理**: 期限設定・進捗追跡
- **サブタスク**: 入れ子構造タスク分解
- **優先度・ラベル**: 重要度・分類管理
- **ステータス管理**: TODO → 進行中 → 完了 → アーカイブ

### ⏱️ 時間管理・生産性

- **ポモドーロタイマー**: 集中セッション・休憩管理
- **実績時間トラッキング**: タスク別作業時間記録
- **統計・ダッシュボード**: 生産性レポート・グラフ表示
- **タイマー履歴**: 作業セッション履歴・分析

### 📝 コンテンツ管理

- **リッチマークダウン**: GFM対応・シンタックスハイライト
- **ファイル・画像アップロード**: ドラッグ&ドロップ対応
- **コメント機能**: マークダウン対応スレッド
- **ノート機能**: タスク詳細・アイデア記録

### 🔍 検索・フィルタリング

- **高度な検索**: タイトル・内容・タグ検索
- **多軸フィルタリング**: プロジェクト・マイルストーン・優先度・ステータス
- **保存済み検索**: よく使う検索条件の保存
- **リアルタイム検索**: 入力に応じたライブフィルタリング

### 🎨 UI/UX

- **かんばんビュー**: ドラッグ&ドロップタスク管理
- **ダークモード**: システム・手動切り替え対応
- **レスポンシブデザイン**: モバイル・タブレット・デスクトップ
- **アニメーション**: Framer Motion によるスムーズな遷移

### 💻 クロスプラットフォーム

- **Webアプリ**: ブラウザ対応（Chrome・Firefox・Safari・Edge）
- **デスクトップアプリ**: Tauri製ネイティブアプリ（Windows・Mac・Linux）
- **リアルタイム同期**: WebSocket によるマルチデバイス同期

### 🔄 繰り返しタスク (実装済み)

- **RRULE 形式のスケジュール**: `FREQ=DAILY/WEEKLY/MONTHLY` + 曜日指定 + 終了日
- **時刻指定生成**: `recurrenceTime` で HH:MM 指定 (デフォルト 00:00)
- **ワークフローファイル継承**: 前回実行の research.md/plan.md を引き継ぎ可能
- **毎時バックグラウンド生成**: `behavior-scheduler` が毎時 0 分に `processAllPendingRecurrences` を実行
- UI: タスク詳細の `RecurrenceSelector` から設定

### 📋 今後の計画

- **タスク依存関係**: ガントチャート・クリティカルパス
- **AI 週次レビュー**: ActivityLog/TimeEntry/PomodoroSession を Claude に集約して月曜朝に自動生成
- **オフラインファースト同期の完成**: 既存 `offline-queue` を全 mutation に統合
- **チーム機能**: 共有プロジェクト・権限管理
- **外部統合**: Slack・Google Calendar 連携

## 🗄️ データベース

### 基本構成

- **データベース**: PostgreSQL v14以上
- **ORM**: Prisma 6.19.0
- **キャッシュ**: Redis（セッション・リアルタイム通信）

### 環境設定

`rapitas-backend/.env`に以下を設定:

```env
# メインデータベース
DATABASE_URL="postgresql://user:password@localhost:5432/rapitas"

# AI API キー
ANTHROPIC_API_KEY="your_claude_api_key"
OPENAI_API_KEY="your_openai_api_key"

# Redis（オプション）
REDIS_URL="redis://localhost:6379"

# WebSocket・セッション設定
JWT_SECRET="your_jwt_secret"
SESSION_SECRET="your_session_secret"
```

### データベースコマンド

```bash
cd rapitas-backend

# スキーマ同期（開発環境）
npx prisma db push

# マイグレーション（本番環境）
npx prisma migrate dev

# データベースリセット
npx prisma migrate reset

# Prisma Studio（GUI管理）
bun run db:studio
```

## 📝 技術スタック

### 🔧 バックエンド

- **ランタイム**: Bun（高速JavaScript/TypeScript実行環境）
- **フレームワーク**: Elysia 1.4.25（型安全・高パフォーマンスWebフレームワーク）
- **ORM**: Prisma 6.19.0（型安全データベースアクセス）
- **データベース**: PostgreSQL 14+
- **AI統合**:
  - Anthropic Claude SDK 0.52.0
  - OpenAI API 6.18.0
  - Google Generative AI 0.24.1
- **リアルタイム**: WebSocket (ws 8.19.0)
- **キャッシュ**: Redis (ioredis 5.4.1)
- **テスト・自動化**: Playwright 1.58.2（スクリーンショット機能）
- **認証・セキュリティ**: bcryptjs, JWT

### 🎨 フロントエンド

- **フレームワーク**: Next.js 16.0.1 (App Router)
- **UI**: React 19.2.0, React DOM 19.2.0
- **スタイリング**: Tailwind CSS v4 + PostCSS
- **コンポーネント**:
  - Radix UI（アクセシブルプリミティブ）
  - Headless UI 2.2.9（非制御コンポーネント）
  - Lucide React（アイコン）
- **アニメーション**: Framer Motion 12.34.2
- **状態管理**:
  - Zustand 5.0.3（軽量状態管理）
  - SWR 2.4.0（データフェッチング）
- **DnD**: @dnd-kit, @hello-pangea/dnd
- **マークダウン**:
  - react-markdown 10.1.0
  - remark-gfm 4.0.1（GitHub Flavored Markdown）
  - react-syntax-highlighter 16.1.0
- **可視化**: Recharts 3.7.0（統計グラフ）
- **リアルタイム**: ネイティブ WebSocket（バックエンドの `ws` と直接通信）

### 💻 デスクトップアプリ

- **フレームワーク**: Tauri 2.10.0
- **Webview**: システムネイティブWebView
- **画像処理**: Sharp 0.34.5, Jimp 1.6.0
- **アイコン生成**: @resvg/resvg-js 2.6.2
- **クロスプラットフォーム**: Windows・Mac・Linux対応

### 🔧 開発ツール・品質管理

- **言語**: TypeScript 5.x（フロント・バック統一）
- **ビルド**: Next.js Built-in + Tauri
- **Linting**: ESLint 9.x + Next.js Config
- **フォーマッター**: Prettier 3.8.1
- **テスト**: Bun Test（バックエンド）
- **ドキュメント**: Storybook 8.6.14
- **型安全**: TypeBox 0.34.15（スキーマバリデーション）

## 🤖 AI機能統合

### 対応AIプロバイダー

- **Anthropic Claude**: 高度な推論・長文理解・コード生成
- **OpenAI GPT**: 汎用的な対話・要約・翻訳
- **Google Gemini**: マルチモーダル・創作支援

### AIエージェント機能

```bash
# AIエージェント実行例
POST /api/ai/execute-agent
{
  "prompt": "タスクの優先度を分析して最適化案を提案",
  "context": "プロジェクトデータ",
  "provider": "claude"
}
```

- **研究フェーズ**: 現状分析・問題特定
- **計画フェーズ**: 実装戦略・リスク評価
- **実行フェーズ**: 自動コード生成・実装
- **検証フェーズ**: 品質チェック・テスト実行

### スクリーンショット機能

Playwright統合により、Webページの自動キャプチャが可能：

```javascript
// 使用例（バックエンドAPI）
GET /api/screenshot?url=https://example.com&viewport=1920x1080
```

## 💻 デスクトップアプリ

### 特長

- **ネイティブパフォーマンス**: Tauri製・軽量（<20MB）
- **システム統合**: OS通知・ファイルアソシエーション
- **オフライン対応**: ローカルデータキャッシュ
- **自動アップデート**: OTA更新対応

### インストール・配布

```bash
# 開発ビルド
cd rapitas-desktop
npm run build

# 本番リリース用ビルド
npm run build -- --features custom-protocol
```

**対応OS:**

- Windows 10/11 (x64, ARM64)
- macOS 10.15+ (Intel, Apple Silicon)
- Linux (Ubuntu 18.04+, Fedora, Arch)

## 🛠️ 開発環境

### 推奨エディタ・拡張機能

**Visual Studio Code:**

- Prettier（コードフォーマッター）
- ESLint（リンター）
- Tailwind CSS IntelliSense
- Prisma（スキーマ編集）
- Tauri（デスクトップ開発）

### デバッグ・トラブルシューティング

#### 🔍 よくある問題

**PostgreSQL接続エラー:**

```bash
# PostgreSQL起動確認
brew services start postgresql  # Mac
sudo systemctl start postgresql  # Linux
```

**ポートコンフリクト（3000/3001）:**

```bash
# プロセス確認・終了
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

**Prismaスキーマ同期エラー:**

```bash
cd rapitas-backend
npx prisma migrate reset  # データベースリセット
npx prisma db push         # スキーマ再同期
```

**Tauriビルドエラー:**

```bash
# Rust toolchain更新
rustup update
cd rapitas-desktop
npm run ci:prepare  # CI環境準備
```

#### 📊 パフォーマンス監視

- **バックエンド**: `http://localhost:3001/health` でヘルスチェック
- **フロントエンド**: Next.js Dev Tools（開発時）
- **データベース**: Prisma Studio でクエリ分析

## 🌟 貢献・開発参加

### 開発フロー

1. **Issue作成**: バグ報告・機能提案
2. **ブランチ作成**: `feature/issue-123-description`
3. **実装・テスト**: 品質基準遵守
4. **Pull Request**: レビュー・承認
5. **マージ**: main ブランチへ統合

### コーディング規約

- **TypeScript**: 厳格モード・型安全
- **ESLint + Prettier**: 自動フォーマット
- **コミットメッセージ**: Conventional Commits
- **テストカバレッジ**: 80%以上維持

### コミット前チェック

コミット時に**自動的にフォーマット/Lintエラーを修正**します：

```bash
# コミット実行（自動修正あり）
git commit -m "your message"
# → エラーがあれば自動修正を試み、成功すればコミット継続
# → 失敗すれば詳細なエラー情報を自動表示

# 手動で修正後、再度コミット
git add .
git commit -m "your message"

# どうしても必要な場合のみ（非推奨）
git commit -m "your message" --no-verify
```

**自動修正の仕組み:**

1. lint-staged を実行（Prettier + ESLint）
2. エラーが出たら自動修正スクリプトを実行
3. 修正したファイルを再ステージング
4. 再度チェック
   - ✅ 成功 → コミット継続
   - ❌ 失敗 → 詳細エラーを自動表示 + 修正方法を提示

**詳細ガイド:** [docs/pre-commit-guide.md](docs/pre-commit-guide.md)

## 📚 ドキュメント

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — システム全体図、サブシステム境界、データモデルの俯瞰
- [docs/adr/](docs/adr/) — 主要な設計判断 (ADR)
- [docs/pre-commit-guide.md](docs/pre-commit-guide.md) — pre-commit フックの詳細
- [CLAUDE.md](CLAUDE.md) — AI エージェント向けの作業ルール

## 📄 ライセンス

[MIT](LICENSE)
