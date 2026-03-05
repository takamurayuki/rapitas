import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateClaudeMdRoute');

interface ClaudeMdRequest {
  genre: string;
  subs: string;
  elems: string;
  plat: string;
  scale: string;
  prio: string;
  proposal: {
    id: string;
    name: string;
    tagline: string;
    concept: string;
    unique: string;
    difficulty: string;
    tech_hint: string[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ClaudeMdRequest = await request.json();
    const { genre, subs, elems, plat, scale, prio, proposal } = body;

    const systemPrompt = `あなたはシニアアーキテクトとClaude Codeエキスパートです。
アプリ要件からClaude Codeが迷わず・高品質に実装できるCLAUDE.mdを生成します。

出力形式（JSONのみ）:
{
  "tech_rationale": "技術選定理由（非技術者向け平易な日本語・3〜4文）",
  "score": 数値,
  "claude_md": "CLAUDE.mdの全文（マークダウン）"
}

## 生成ルール（厳守）

### 技術は必ず1つに確定する
❌ "Next.js または Nuxt.js" → ✅ "Next.js 14（理由: ...）"
❌ "Firebase か Supabase" → ✅ "Supabase（理由: ...）"

### 必須セクション（この順序で）
1. # Project Overview（アプリ名・コンセプト・対象ユーザー・規模）
2. # Tech Stack（確定技術 + 各選定理由）
3. # Architecture（ディレクトリ構成スケルトン付き）
4. # Development Commands（実際のコマンドをコードブロックで全列挙）
5. # Coding Rules（命名規則・禁止パターン・❌NG例付き）
6. # Testing Policy（レイヤー別テスト・ツール・カバレッジ目標）
7. # Git Policy（ブランチ戦略・コミット規約・PRルール）
8. # Claude Behavior ← 最重要・最も詳細に書く
9. # Security & Scale（スケール・セキュリティ方針）
10. # Environment Variables（必要な環境変数一覧 .env.example形式）
11. # Important Notes（禁止事項リスト・地雷リスト）

### Claude Behaviorに必ず含める内容
- 実装前に設計提案が必要なケース（DBスキーマ変更・新API・認証フロー変更など）
- 不明点は仮定で進めず必ず質問する
- テスト・ドキュメントも同時に更新する
- 禁止行動（本番DB操作・APIキーハードコード・承認なしのスキーマ変更など）
- コミットのタイミングと粒度
- チェックリスト形式で「実装前・実装中・実装後」の行動指針

### スコア基準
Claude Codeの実用スコアを100点満点で自己採点（95点以上を目標に生成）

JSONのみ出力。`;

    const userMessage = `
アプリ名: ${proposal.name}
コンセプト: ${proposal.concept}
ジャンル: ${genre} / ${subs}
追加機能: ${elems}
プラットフォーム: ${plat}
規模: ${scale}
優先事項: ${prio}
独自機能: ${proposal.unique}
技術ヒント: ${proposal.tech_hint?.join("、")||""}
`.trim();

    // 実際のClaude APIの代わりに、モックデータを返します
    // 本格実装時はここでClaude APIを呼び出します
    const mockResponse = {
      tech_rationale: "Next.js 14とSupabaseを選定しました。Next.jsはReactベースの高性能フレームワークで、開発効率とSEO最適化を両立できます。SupabaseはPostgreSQLベースのBaaSで、認証・リアルタイム機能・APIが統合されており、開発速度を大幅に向上させます。TailwindCSSは保守性の高いスタイリングを提供します。",
      score: 96,
      claude_md: `# Project Overview

**アプリ名**: ${proposal.name}
**コンセプト**: ${proposal.concept}
**独自機能**: ${proposal.unique}
**対象ユーザー**: ${scale === "solo" ? "個人利用者" : scale === "small" ? "小規模チーム（〜100人）" : scale === "mid" ? "中規模組織（〜1万人）" : "大規模組織（1万人以上）"}
**プラットフォーム**: ${plat}

# Tech Stack

## フロントエンド
- **Next.js 14** - App Router使用、React Serverコンポーネント対応
- **TypeScript** - 型安全性確保、開発効率向上
- **Tailwind CSS** - ユーティリティファーストCSS、保守性重視
- **React Hook Form** - フォーム管理、バリデーション
- **Zustand** - 軽量状態管理

## バックエンド・インフラ
- **Supabase** - PostgreSQL、認証、リアルタイム機能
- **Vercel** - ホスティング、CI/CD
- **CloudFlare** - CDN、セキュリティ

## 開発ツール
- **ESLint** - コード品質チェック
- **Prettier** - コードフォーマット
- **Husky** - Git hooks
- **Jest + Testing Library** - ユニット・結合テスト

# Architecture

## ディレクトリ構成

\`\`\`
${proposal.name.toLowerCase()}/
├── src/
│   ├── app/                    # App Router
│   │   ├── (auth)/            # 認証ルートグループ
│   │   ├── dashboard/         # ダッシュボード
│   │   ├── api/               # API Routes
│   │   ├── globals.css        # グローバルスタイル
│   │   ├── layout.tsx         # ルートレイアウト
│   │   └── page.tsx           # ホームページ
│   ├── components/            # 再利用コンポーネント
│   │   ├── ui/               # UIコンポーネント
│   │   └── layouts/          # レイアウトコンポーネント
│   ├── hooks/                # カスタムフック
│   ├── lib/                  # ユーティリティ・設定
│   ├── store/                # Zustore
│   ├── types/                # TypeScript型定義
│   └── utils/                # ヘルパー関数
├── public/                   # 静的ファイル
├── tests/                    # テストファイル
├── supabase/                 # Supabaseスキーマ・設定
└── docs/                     # ドキュメント
\`\`\`

# Development Commands

\`\`\`bash
# プロジェクト初期化
npm create next-app@latest ${proposal.name.toLowerCase()} --typescript --tailwind --app

# 依存関係インストール
npm install @supabase/supabase-js zustand react-hook-form @hookform/resolvers zod lucide-react

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プロダクション起動
npm start

# テスト実行
npm test
npm run test:watch
npm run test:coverage

# Lint・フォーマット
npm run lint
npm run lint:fix
npm run format

# Supabaseローカル起動
npx supabase start
npx supabase db reset
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/supabase.ts
\`\`\`

# Coding Rules

## 命名規則
- **コンポーネント**: PascalCase (\`UserProfile\`)
- **hooks**: camelCase + \`use\`プレフィックス (\`useUserData\`)
- **関数・変数**: camelCase (\`handleSubmit\`, \`userData\`)
- **定数**: UPPER_SNAKE_CASE (\`API_BASE_URL\`)
- **ファイル名**: kebab-case (\`user-profile.tsx\`)

## 禁止パターン
- ❌ \`any\`型の使用（型を明確にする）
- ❌ インライン styles（TailwindCSSまたはCSS Modulesを使用）
- ❌ useEffectの依存配列省略
- ❌ ハードコードされたAPIキー・秘匿情報
- ❌ console.logの本番環境残留

## 推奨パターン
- ✅ Server Componentsを優先、必要時のみClient Components
- ✅ カスタムhooksで複雑なロジック分離
- ✅ 型定義ファイルの活用
- ✅ エラーハンドリングの徹底

# Testing Policy

## テスト戦略
- **ユニットテスト**: 全ユーティリティ関数・hooks（80%カバレッジ）
- **結合テスト**: 主要コンポーネント・API routes
- **E2Eテスト**: 重要ユーザーフロー

## ツール
- **Jest** - テストランナー
- **Testing Library** - React コンポーネントテスト
- **MSW** - APIモック
- **Playwright** - E2Eテスト

# Git Policy

## ブランチ戦略
- \`main\`: プロダクション環境
- \`develop\`: 開発環境
- \`feature/*\`: 機能開発
- \`hotfix/*\`: 緊急修正

## コミット規約
\`\`\`
feat: 新機能追加
fix: バグ修正
docs: ドキュメント更新
style: コードフォーマット
refactor: リファクタリング
test: テスト追加・修正
chore: ビルド・設定変更
\`\`\`

# Claude Behavior

## 実装前チェックリスト
- [ ] 要件が明確か？不明点は必ず質問する
- [ ] DBスキーマ変更の場合、設計提案を行う
- [ ] 新API作成時、エラーハンドリング・バリデーションを含める
- [ ] セキュリティ影響を評価する

## 実装中の行動指針
- [ ] 一度に一つの機能に集中する
- [ ] TypeScript型定義を最初に作成する
- [ ] テストファーストで実装する
- [ ] エラーケースも考慮して実装する

## 実装後チェックリスト
- [ ] ユニットテスト追加・実行
- [ ] 型エラーがないか確認
- [ ] Lint・フォーマットチェック
- [ ] 実装した機能をドキュメント化

## 絶対禁止事項
- ❌ 本番データベースの直接操作
- ❌ APIキーのハードコード
- ❌ 承認なしのスキーマ変更
- ❌ テストなしの重要機能実装
- ❌ 不明点を仮定で進める

## コミット粒度
- 一つの論理的変更 = 一つのコミット
- 機能完成時点でコミット
- 作業途中でもセーブポイントとしてコミット

# Security & Scale

## セキュリティ
- Row Level Security (RLS) 設定
- 入力値サニタイゼーション
- CSRF対策
- 環境変数での秘匿情報管理

## スケール対応
- 画像最適化 (Next.js Image)
- コード分割・遅延ローディング
- キャッシュ戦略
- CDN活用

# Environment Variables

\`\`\`env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# アプリ固有設定
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=${proposal.name}
\`\`\`

# Important Notes

## 地雷リスト
- Supabase RLS未設定でのデータ公開
- Next.js Server/Client境界の混同
- 無限再レンダリング（useEffectの依存配列ミス）
- 型安全性を損なう \`any\` の多用

## 開発時注意点
- Server Componentsでの状態管理は不可
- Client Components内でのSupabase認証情報取得
- ビルド時の静的生成エラー対策
- TypeScript strict mode対応

---

このCLAUDE.mdは${proposal.name}プロジェクト専用に最適化されています。
実装開始前に要件を再確認し、不明点があれば遠慮なく質問してください。`
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    logger.error('Error generating Claude MD:', error);
    return NextResponse.json(
      { error: 'CLAUDE.mdの生成に失敗しました' },
      { status: 500 }
    );
  }
}