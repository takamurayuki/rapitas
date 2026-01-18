# Rapitas

階層型タスク管理システム

## プロジェクト構成

```
rapitas/
├── rapitas-backend/   # バックエンド (Bun + Elysia + Prisma)
├── rapitas-frontend/  # フロントエンド (Next.js 16 + React 19)
└── start-dev.ps1      # 開発環境起動スクリプト
```

## 🚀 クイックスタート

### 方法 1: PowerShell スクリプト（推奨）

```powershell
# シンプル版（別ウィンドウで起動）
.\start-dev-simple.ps1

# 統合版（1つのウィンドウで管理）
.\start-dev.ps1
```

### 方法 2: npm 経由

```bash
# 初回のみ: concurrentlyをインストール
npm install

# 開発サーバー起動
npm run dev
```

### 方法 3: 個別起動

```bash
# バックエンド
cd rapitas-backend
bun run index.ts

# フロントエンド（別ターミナル）
cd rapitas-frontend
npm run dev
```

## 📌 アクセス URL

- **フロントエンド**: http://localhost:3000
- **バックエンド API**: http://localhost:3001

## 🛠️ 利用可能なコマンド

```bash
# 開発サーバー起動（バックエンド + フロントエンド）
npm run dev

# バックエンドのみ起動
npm run dev:backend

# フロントエンドのみ起動
npm run dev:frontend

# 依存関係を一括インストール
npm run install:all

# Prismaマイグレーション実行
npm run prisma:migrate

# Prisma Clientを再生成
npm run prisma:generate

# Prisma Studio起動（DB管理GUI）
npm run prisma:studio
```

## 📦 初期セットアップ

```bash
# 1. 依存関係をインストール
npm run install:all

# 2. データベースをセットアップ
npm run prisma:migrate

# 3. 開発サーバー起動
npm run dev
```

## 🎯 主な機能

### ✅ 実装済み

- プロジェクト管理（色分け、アイコン設定）
- マイルストーン管理（期限設定）
- タスク管理（優先度、ラベル、見積時間）
- サブタスク機能
- マークダウン対応（コードブロック、シンタックスハイライト）
- ファイル・画像アップロード（ドラッグ&ドロップ）
- かんばんビュー
- フィルタリング機能（プロジェクト、マイルストーン、優先度、ステータス）
- 実績時間トラッキング（タイマー機能）
- コメント機能（マークダウン対応）

### 📋 計画中

- ダッシュボード・統計機能
- 検索・タグ機能
- 繰り返しタスク機能
- 依存関係機能

## 🗄️ データベース

PostgreSQL を使用。接続情報は`rapitas-backend/.env`で設定:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/rapitas"
```

## 📝 技術スタック

### バックエンド

- **ランタイム**: Bun
- **フレームワーク**: Elysia
- **ORM**: Prisma
- **データベース**: PostgreSQL

### フロントエンド

- **フレームワーク**: Next.js 16 (App Router)
- **UI**: React 19, Tailwind CSS 4
- **マークダウン**: react-markdown, remark-gfm
- **シンタックスハイライト**: react-syntax-highlighter

## 📄 ライセンス

Private
