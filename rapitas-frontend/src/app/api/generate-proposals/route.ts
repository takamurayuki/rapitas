import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateProposalsRoute');

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
).replace('localhost', '127.0.0.1');

interface ProposalRequest {
  genre: string;
  subs: string;
  elems: string;
  plat: string;
  scale: string;
  prio: string;
}

interface Proposal {
  id: string;
  name: string;
  tagline: string;
  concept: string;
  unique: string;
  difficulty: string;
  tech_hint: string[];
}

function buildSystemPrompt(): string {
  return `あなたは世界トップクラスのプロダクトストラテジストであり、テックスタートアップのビジョナリーです。
ユーザーの選択から、**まだ誰も作っていない革新的なアプリ**のコンセプトを3案提案してください。

## 出力形式（JSONのみ・説明文不要）
{
  "proposals": [
    {
      "id": "A",
      "name": "アプリ名（キャッチーで記憶に残る）",
      "tagline": "一言キャッチコピー（20字以内）",
      "concept": "どんなアプリか。従来にない革新ポイントを含めて説明（80〜120字）",
      "unique": "このアプリならではの独自機能・なぜ今までなかったか（50字以内）",
      "difficulty": "easy|medium|hard",
      "tech_hint": ["技術1", "技術2", "技術3", "技術4"]
    }
  ]
}

## 革新的な提案のための指針

### 3案の方向性（必ずこの3軸で分ける）
1. **ブルーオーシャン案**: 既存カテゴリの常識を壊す。異なる分野同士の掛け合わせ（例: フィットネス×音楽制作、家計簿×ゲーミフィケーション）。「なぜ今までなかったんだ」と思わせるもの
2. **テクノロジー駆動案**: 最新技術（AI/ML, WebRTC, WebGPU, AR/VR, エッジコンピューティング, ローカルLLM等）を活用した、技術的にワクワクする体験。技術デモではなく実用的な価値を提供すること
3. **社会課題×ニッチ案**: 見過ごされがちな社会課題やニッチなコミュニティのペインを解決する。小さいが熱狂的なユーザー基盤を持てるもの

### 禁止事項
- タスク管理アプリ、TODOアプリ、メモアプリなど**ありふれたジャンル**の提案
- 「AIで〇〇を効率化」だけの表面的な提案
- 既存の有名アプリ（Notion, Slack, Trello等）の焼き直し
- 抽象的すぎて実装イメージが湧かない提案

### 品質基準
- アプリ名は造語や掛け合わせ語で、検索で一意になるもの
- コンセプトは「誰の、どんな場面の、どんな課題を、どう解決するか」を具体的に
- tech_hintは実際に使う具体的な技術スタック（3〜4個）
- difficultyは実装の複雑さを正直に評価

JSONのみ出力。`;
}

function parseAIResponse(content: string): { proposals: Proposal[] } | null {
  // Remove markdown code blocks if present
  let cleaned = content.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed.proposals &&
      Array.isArray(parsed.proposals) &&
      parsed.proposals.length > 0
    ) {
      // Validate each proposal has required fields
      const valid = parsed.proposals.every(
        (p: Proposal) =>
          p.id &&
          p.name &&
          p.tagline &&
          p.concept &&
          p.unique &&
          p.difficulty &&
          p.tech_hint,
      );
      if (valid) return parsed;
    }
  } catch {
    // Try to extract JSON from mixed content
    const jsonMatch = cleaned.match(/\{[\s\S]*"proposals"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.proposals?.length > 0) return parsed;
      } catch {
        // Fall through to null
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body: ProposalRequest = await request.json();
    const { genre, subs, elems, plat, scale, prio } = body;

    const systemPrompt = buildSystemPrompt();
    const userMessage = `ジャンル: ${genre}
サブジャンル: ${subs}
追加要素: ${elems}
プラットフォーム: ${plat}
規模: ${scale}
優先事項: ${prio}`;

    // Try AI generation via backend
    let errorMessage = '';
    try {
      const response = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          systemPrompt,
          conversationHistory: [],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.message) {
          const parsed = parseAIResponse(data.message);
          if (parsed) {
            return NextResponse.json(parsed);
          }
          logger.warn(
            'AI response could not be parsed as valid proposals JSON',
          );
          errorMessage =
            'AIからの応答を解析できませんでした。再試行してください。';
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        logger.warn('Backend AI chat returned error:', errData);
        errorMessage =
          errData.error ||
          `AIサーバーからエラーが返されました（ステータス: ${response.status}）`;
      }
    } catch (aiError) {
      logger.warn('AI generation failed:', aiError);
      if (aiError instanceof DOMException && aiError.name === 'TimeoutError') {
        errorMessage =
          'AIからの応答がタイムアウトしました。再試行してください。';
      } else {
        errorMessage = 'AIサービスへの接続に失敗しました。';
      }
    }

    // No static fallback - return error so frontend can show retry
    return NextResponse.json({ proposals: [], aiFailed: true, errorMessage });
  } catch (error) {
    logger.error('Error generating proposals:', error);
    return NextResponse.json(
      { error: 'プロポーザルの生成に失敗しました' },
      { status: 500 },
    );
  }
}
