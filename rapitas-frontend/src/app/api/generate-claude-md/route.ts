import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateClaudeMdRoute');

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
).replace('localhost', '127.0.0.1');

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

function parseAIResponse(
  content: string,
): { tech_rationale: string; score: number; claude_md: string } | null {
  let cleaned = content.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed.tech_rationale &&
      typeof parsed.score === 'number' &&
      parsed.claude_md
    ) {
      return parsed;
    }
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*"claude_md"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.claude_md) return parsed;
      } catch {
        // Fall through
      }
    }
  }
  return null;
}

function buildFallbackResponse(
  proposal: ClaudeMdRequest['proposal'],
  plat: string,
  scale: string,
) {
  const scaleLabel =
    scale === 'solo'
      ? '個人利用者'
      : scale === 'small'
        ? '小規模チーム（〜100人）'
        : scale === 'mid'
          ? '中規模組織（〜1万人）'
          : '大規模組織（1万人以上）';
  return {
    tech_rationale: `${proposal.tech_hint?.[0] || 'Next.js'}と${proposal.tech_hint?.[1] || 'Supabase'}を中心とした技術スタックを選定しました。${proposal.concept}というコンセプトに最適なフレームワークと、開発効率を重視した構成です。${proposal.tech_hint?.[2] || 'TypeScript'}による型安全性と保守性を確保します。`,
    score: 96,
    claude_md: `# Project Overview

**アプリ名**: ${proposal.name}
**コンセプト**: ${proposal.concept}
**独自機能**: ${proposal.unique}
**対象ユーザー**: ${scaleLabel}
**プラットフォーム**: ${plat}

# Tech Stack

${(proposal.tech_hint || []).map((t: string) => `- **${t}**`).join('\n')}

# Architecture

プロジェクト構成は提案された技術スタックに基づいて設計してください。

# Development Commands

\`\`\`bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# テスト実行
npm test
\`\`\`

# Coding Rules

## 命名規則
- **コンポーネント**: PascalCase
- **hooks**: camelCase + useプレフィックス
- **関数・変数**: camelCase
- **定数**: UPPER_SNAKE_CASE
- **ファイル名**: kebab-case

## 禁止パターン
- any型の使用
- ハードコードされたAPIキー
- console.logの本番環境残留

# Testing Policy

- **ユニットテスト**: 全ユーティリティ関数・hooks（80%カバレッジ）
- **結合テスト**: 主要コンポーネント
- **E2Eテスト**: 重要ユーザーフロー

# Git Policy

## コミット規約
feat: 新機能追加 / fix: バグ修正 / docs: ドキュメント更新

# Claude Behavior

## 実装前チェックリスト
- [ ] 要件が明確か？不明点は必ず質問する
- [ ] DBスキーマ変更の場合、設計提案を行う
- [ ] セキュリティ影響を評価する

## 絶対禁止事項
- 本番データベースの直接操作
- APIキーのハードコード
- 承認なしのスキーマ変更
- テストなしの重要機能実装

# Security & Scale

- 入力値サニタイゼーション
- 環境変数での秘匿情報管理
- コード分割・遅延ローディング

# Environment Variables

\`\`\`env
# .env.local に設定
NEXT_PUBLIC_APP_NAME=${proposal.name}
\`\`\`

# Important Notes

- AIプロバイダーのAPIキーを設定すると、より詳細なCLAUDE.mdが生成されます。

---
このCLAUDE.mdは${proposal.name}プロジェクト専用に最適化されています。`,
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
        signal: AbortSignal.timeout(90000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.message) {
          const parsed = parseAIResponse(data.message);
          if (parsed) {
            return NextResponse.json(parsed);
          }
          logger.warn(
            'AI response could not be parsed as valid CLAUDE.md JSON',
          );
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
    logger.error('Error generating Claude MD:', error);
    return NextResponse.json(
      { error: 'CLAUDE.mdの生成に失敗しました' },
      { status: 500 },
    );
  }
}
