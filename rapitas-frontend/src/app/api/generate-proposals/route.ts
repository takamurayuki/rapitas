import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateProposalsRoute');

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

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

function getFallbackProposals(
  genre: string,
  subs: string,
  elems: string,
): { proposals: Proposal[] } {
  // Dynamic fallback based on genre for better variety even without API
  const fallbacks: Record<string, Proposal[]> = {
    game: [
      {
        id: 'A',
        name: 'MindForge',
        tagline: '思考がゲームになる',
        concept:
          '日常の意思決定をRPGのクエストに変換するアプリ。買い物や勉強の選択がスキルポイントとして蓄積され、自分だけのキャラクターが成長する。',
        unique: '現実の行動データをゲームメカニクスに自動変換するAIエンジン',
        difficulty: 'hard',
        tech_hint: ['React Native', 'TensorFlow.js', 'Supabase', 'Expo'],
      },
      {
        id: 'B',
        name: 'SoundQuest',
        tagline: '音で冒険する世界',
        concept:
          '周囲の環境音をリアルタイム解析し、音の風景に基づいたロケーションベースのアドベンチャーゲーム。雨の日と晴れの日で異なるクエストが出現。',
        unique: 'Web Audio APIによる環境音認識とプロシージャル生成の融合',
        difficulty: 'hard',
        tech_hint: ['Next.js', 'Web Audio API', 'Mapbox', 'WebGL'],
      },
      {
        id: 'C',
        name: 'PlantBattle',
        tagline: '育てた植物で対戦',
        concept:
          '実際の植物の成長写真をAIが解析し、デジタルモンスターに変換。育成した植物同士でターン制バトルができるコミュニティアプリ。',
        unique:
          '画像認識で実際の植物がゲームキャラに変化するリアル連動システム',
        difficulty: 'medium',
        tech_hint: ['Flutter', 'Firebase', 'Vision AI', 'Cloud Functions'],
      },
    ],
    default: [
      {
        id: 'A',
        name: 'Serendip',
        tagline: '偶然の出会いを設計する',
        concept:
          '位置情報と興味関心データを基に、予期しない体験やコンテンツとの出会いを演出するアプリ。アルゴリズムの真逆を行く「反レコメンド」エンジン搭載。',
        unique: 'フィルターバブルを意図的に破壊する逆アルゴリズム設計',
        difficulty: 'hard',
        tech_hint: ['Next.js', 'PostGIS', 'Redis', 'WebSocket'],
      },
      {
        id: 'B',
        name: 'SkillSwap',
        tagline: 'スキルの物々交換',
        concept:
          '金銭を介さずスキルと時間を交換するマッチングプラットフォーム。プログラミングを教える代わりに料理を教わるなど、等価交換の新経済圏。',
        unique: 'スキル価値の自動算定AIと信頼スコアによる安全な交換保証',
        difficulty: 'medium',
        tech_hint: ['Next.js', 'Supabase', 'Stripe Connect', 'Tailwind CSS'],
      },
      {
        id: 'C',
        name: 'MoodCanvas',
        tagline: '感情を可視化するアート',
        concept:
          'テキスト日記や音声入力から感情をAI解析し、毎日のムードを抽象アートとして自動生成。月単位で感情の変遷がギャラリーとして閲覧できる。',
        unique: '感情分析×ジェネラティブアートの自動生成パイプライン',
        difficulty: 'medium',
        tech_hint: ['React', 'Hugging Face', 'Canvas API', 'Supabase'],
      },
    ],
  };

  return { proposals: fallbacks[genre] || fallbacks.default };
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
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        logger.warn('Backend AI chat returned error:', errData);
      }
    } catch (aiError) {
      logger.warn('AI generation failed, falling back to mock data:', aiError);
    }

    // Fallback: return genre-aware mock data
    return NextResponse.json(getFallbackProposals(genre, subs, elems));
  } catch (error) {
    logger.error('Error generating proposals:', error);
    return NextResponse.json(
      { error: 'プロポーザルの生成に失敗しました' },
      { status: 500 },
    );
  }
}
