import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateClaudeMdRoute');

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001').replace(
  'localhost',
  '127.0.0.1',
);

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

interface GenerateResult {
  tech_rationale: string;
  score: number;
  requirements: string;
  design: string;
  claude_md: string;
}

// NOTE: The wizard now produces a 3-document implementation package — a
// requirements spec, a design spec, and an agent behavior guide — so an AI
// coding agent can start implementing immediately without further clarification.
const systemPrompt = `あなたはシニアプロダクトマネージャー兼ソフトウェアアーキテクトです。
与えられたアプリ要件から、AIコーディングエージェントが追加質問なしで即実装に着手できる
「要件定義書」「設計書」「エージェント行動規範(CLAUDE.md)」の3点セットを生成します。

出力形式（JSONのみ・他の文字列は一切含めない）:
{
  "tech_rationale": "技術選定理由（非技術者向けの平易な日本語・3〜4文）",
  "score": 数値,
  "requirements": "要件定義書の全文（マークダウン）",
  "design": "設計書の全文（マークダウン）",
  "claude_md": "CLAUDE.mdの全文（マークダウン）"
}

## 共通ルール（厳守）
- 技術は必ず1つに確定する。"AかB" のような曖昧表現は禁止（❌"Next.js または Nuxt" → ✅"Next.js 14（理由:...）"）。
- 具体的・実装可能なレベルまで落とし込む。抽象的な一般論で埋めない。
- 日本語で記述する（コード・コマンド・識別子は英語のまま）。

## requirements（要件定義書）に必ず含めるセクション（この順序）
1. # 概要（アプリ名・解決する課題・ターゲットユーザー・提供価値）
2. # ユーザーストーリー（「〜として、〜したい、なぜなら〜」形式で主要5〜8件）
3. # 機能要件（機能ごとにID付き [F-01] 形式・入力/処理/出力を明記）
4. # 画面一覧（画面名・目的・主要UI要素・画面遷移）
5. # 非機能要件（性能・セキュリティ・可用性・対応端末/ブラウザ）
6. # 受け入れ基準（機能IDごとにGiven/When/Thenのチェックリスト）
7. # スコープ外（今回作らないものを明記）

## design（設計書）に必ず含めるセクション（この順序）
1. # アーキテクチャ概要（構成図をテキスト/Mermaidで・各層の責務）
2. # 技術スタック（確定技術 + バージョン + 各選定理由）
3. # ディレクトリ構成（実際のツリーをコードブロックで）
4. # データモデル（主要エンティティ・属性・型・リレーション。可能ならPrisma/SQLスキーマ例）
5. # API設計（エンドポイント・メソッド・リクエスト/レスポンス例。機能IDと対応付け）
6. # 主要処理フロー（重要ユースケースのシーケンスを箇条書き/Mermaidで）
7. # エラーハンドリング/バリデーション方針
8. # 環境変数（.env.example形式の一覧）

## claude_md（CLAUDE.md / エージェント行動規範）に必ず含めるセクション
1. # Project Overview（アプリ名・1行コンセプト・関連ドキュメントへの参照: docs/requirements.md, docs/design.md）
2. # Development Commands（実際のコマンドをコードブロックで全列挙）
3. # Coding Rules（命名規則・禁止パターン・❌NG例付き）
4. # Testing Policy（レイヤー別・ツール・カバレッジ目標）
5. # Git Policy（ブランチ戦略・コミット規約・PRルール）
6. # Claude Behavior（最重要・最も詳細に）:
   - 実装前に設計提案が必要なケース（DBスキーマ変更・新API・認証フロー変更）
   - 不明点は仮定で進めず必ず質問する
   - テスト・ドキュメントも同時に更新する
   - 禁止行動（本番DB操作・APIキーハードコード・承認なしのスキーマ変更）
   - 「実装前・実装中・実装後」のチェックリスト

### スコア基準
3点セット全体が「AIエージェントが即実装着手できる」完成度を100点満点で自己採点（95点以上を目標）。

JSONのみ出力。`;

/**
 * Parse the AI JSON envelope into the 3-document result, tolerating code fences
 * and surrounding prose. / コードフェンスや前後の文章を許容してJSONを抽出する。
 */
function parseAIResponse(content: string): GenerateResult | null {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  const accept = (parsed: Record<string, unknown>): GenerateResult | null => {
    if (typeof parsed.claude_md !== 'string' || !parsed.claude_md) return null;
    return {
      tech_rationale: typeof parsed.tech_rationale === 'string' ? parsed.tech_rationale : '',
      score: typeof parsed.score === 'number' ? parsed.score : 95,
      requirements: typeof parsed.requirements === 'string' ? parsed.requirements : '',
      design: typeof parsed.design === 'string' ? parsed.design : '',
      claude_md: parsed.claude_md,
    };
  };

  try {
    return accept(JSON.parse(cleaned));
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*"claude_md"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return accept(JSON.parse(jsonMatch[0]));
      } catch {
        // Fall through
      }
    }
  }
  return null;
}

/**
 * Build a deterministic 3-document package when the AI provider is unavailable,
 * so the wizard still yields a usable scaffold. / AI不在時の決定的フォールバック。
 */
function buildFallbackResponse(
  proposal: ClaudeMdRequest['proposal'],
  plat: string,
  scale: string,
): GenerateResult {
  const scaleLabel =
    scale === 'solo'
      ? '個人利用者'
      : scale === 'small'
        ? '小規模チーム（〜100人）'
        : scale === 'mid'
          ? '中規模組織（〜1万人）'
          : '大規模組織（1万人以上）';
  const stack = proposal.tech_hint?.length
    ? proposal.tech_hint
    : ['Next.js 14', 'Supabase', 'TypeScript'];

  return {
    tech_rationale: `${stack[0]}と${stack[1] || 'Supabase'}を中心とした技術スタックを選定しました。${proposal.concept}というコンセプトに最適なフレームワークと、開発効率を重視した構成です。${stack[2] || 'TypeScript'}による型安全性と保守性を確保します。`,
    score: 96,
    requirements: `# 概要

**アプリ名**: ${proposal.name}
**解決する課題**: ${proposal.concept}
**ターゲットユーザー**: ${scaleLabel}
**提供価値**: ${proposal.unique}
**プラットフォーム**: ${plat}

# ユーザーストーリー

- ユーザーとして、${proposal.concept}を達成したい。なぜなら${proposal.unique}だから。
- 新規ユーザーとして、迷わず初期設定を終えたい。なぜなら離脱したくないから。

# 機能要件

- **[F-01] コア機能**: ${proposal.unique}（入力 → 処理 → 出力を実装時に具体化する）
- **[F-02] 認証**: サインアップ / ログイン / ログアウト
- **[F-03] データ管理**: 主要エンティティのCRUD

# 画面一覧

- ランディング / ダッシュボード / 詳細 / 設定

# 非機能要件

- 性能: 主要操作のレスポンス 300ms 以内（目標）
- セキュリティ: 入力値サニタイズ・秘匿情報は環境変数

# 受け入れ基準

- [ ] [F-01] Given 前提 / When 操作 / Then 期待結果

# スコープ外

- 実装フェーズで合意するまで未確定の機能は対象外。`,
    design: `# アーキテクチャ概要

クライアント（${plat}） → アプリケーション層 → データストア の3層構成。

# 技術スタック

${stack.map((t) => `- **${t}**`).join('\n')}

# ディレクトリ構成

\`\`\`
src/
├── app/          # 画面・ルーティング
├── components/   # UIコンポーネント
├── lib/          # ドメインロジック
└── types/        # 型定義
\`\`\`

# データモデル

主要エンティティを実装時に確定する（例: User, ${proposal.name.replace(/\s+/g, '')}Item）。

# API設計

- \`GET /api/items\` 一覧取得 / \`POST /api/items\` 作成（[F-03] と対応）

# 環境変数

\`\`\`env
NEXT_PUBLIC_APP_NAME=${proposal.name}
\`\`\``,
    claude_md: `# Project Overview

**アプリ名**: ${proposal.name}
**コンセプト**: ${proposal.concept}
**関連ドキュメント**: \`docs/requirements.md\`（要件定義） / \`docs/design.md\`（設計）

# Development Commands

\`\`\`bash
npm run dev    # 開発サーバー起動
npm run build  # ビルド
npm test       # テスト実行
\`\`\`

# Coding Rules

- **コンポーネント**: PascalCase / **hooks**: useプレフィックス + camelCase
- **関数・変数**: camelCase / **定数**: UPPER_SNAKE_CASE / **ファイル名**: kebab-case
- 禁止: any型 / ハードコードされたAPIキー / console.logの本番残留

# Testing Policy

- ユニット: ユーティリティ・hooks（80%カバレッジ）
- 結合: 主要コンポーネント / E2E: 重要ユーザーフロー

# Git Policy

- feat / fix / docs / refactor / test / chore（imperative mood・英語）

# Claude Behavior

## 実装前チェックリスト
- [ ] 要件が明確か？不明点は必ず質問する
- [ ] DBスキーマ変更時は設計提案を行う
- [ ] セキュリティ影響を評価する

## 絶対禁止事項
- 本番データベースの直接操作 / APIキーのハードコード
- 承認なしのスキーマ変更 / テストなしの重要機能実装

---
AIプロバイダーのAPIキーを設定すると、より詳細な3点セットが生成されます。`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ClaudeMdRequest = await request.json();
    const { genre, subs, elems, plat, scale, prio, proposal } = body;

    const userMessage = `
アプリ名: ${proposal.name}
コンセプト: ${proposal.concept}
ジャンル: ${genre} / ${subs}
追加機能: ${elems}
プラットフォーム: ${plat}
規模: ${scale}
優先事項: ${prio}
独自機能: ${proposal.unique}
技術ヒント: ${proposal.tech_hint?.join('、') || ''}
`.trim();

    // Try AI generation via backend
    try {
      const response = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          systemPrompt,
          conversationHistory: [],
        }),
        // NOTE: Larger timeout than single-doc generation — three documents take longer.
        signal: AbortSignal.timeout(150000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.message) {
          const parsed = parseAIResponse(data.message);
          if (parsed) {
            return NextResponse.json(parsed);
          }
          logger.warn('AI response could not be parsed as valid document-package JSON');
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        logger.warn('Backend AI chat returned error:', errData);
      }
    } catch (aiError) {
      logger.warn('AI generation failed, falling back to mock data:', aiError);
    }

    // Fallback
    return NextResponse.json(buildFallbackResponse(proposal, plat, scale));
  } catch (error) {
    logger.error('Error generating document package:', error);
    return NextResponse.json({ error: 'ドキュメントの生成に失敗しました' }, { status: 500 });
  }
}
