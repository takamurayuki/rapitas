import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateSuggestionsRoute');

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
).replace('localhost', '127.0.0.1');

interface DynamicItem {
  id: string;
  icon: string;
  label: string;
}

interface SuggestionsRequest {
  type: 'sub_genres' | 'elements';
  genre?: string;
  subs?: string[];
}

function buildSubGenreSystemPrompt(): string {
  return `あなたは世界トップクラスのプロダクトストラテジストです。
ユーザーが選択したジャンルに基づき、**具体的で実装しやすいサブジャンル候補**を6-8個提案してください。

## 出力形式（JSONのみ・説明文不要）
{
  "suggestions": [
    {
      "id": "サブジャンルのユニークID（英数字、snake_case）",
      "icon": "絵文字1文字",
      "label": "サブジャンル名（日本語、15字以内）"
    }
  ]
}

## 指針
- 選択されたジャンルの特性を活かした具体的なサブジャンル
- 実装可能性を重視（抽象的すぎないもの）
- 多様性のある候補（似たようなものは避ける）
- 現代的なトレンドを考慮
- アイコンは直感的で分かりやすいもの

JSONのみ出力。`;
}

function buildElementSystemPrompt(): string {
  return `あなたは世界トップクラスのプロダクトストラテジストです。
ユーザーが選択したジャンルとサブジャンルに基づき、**アプリに実装できる具体的な機能要素**を10-12個提案してください。

## 出力形式（JSONのみ・説明文不要）
{
  "suggestions": [
    {
      "id": "機能要素のユニークID（英数字、snake_case）",
      "icon": "絵文字1文字",
      "label": "機能要素名（日本語、20字以内）"
    }
  ]
}

## 指針
- 選択されたジャンル・サブジャンルに適した実用的な機能
- 技術的に実装可能な範囲
- 基本機能から高度な機能まで幅広く
- モダンなアプリに期待される機能
- ユーザー体験を向上させる要素
- アイコンは機能を直感的に表現

JSONのみ出力。`;
}

function parseAIResponse(
  content: string,
): { suggestions: DynamicItem[] } | null {
  // Remove markdown code blocks if present
  let cleaned = content.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed.suggestions &&
      Array.isArray(parsed.suggestions) &&
      parsed.suggestions.length > 0
    ) {
      // Validate each suggestion has required fields
      const valid = parsed.suggestions.every(
        (s: DynamicItem) =>
          s.id &&
          s.icon &&
          s.label &&
          typeof s.id === 'string' &&
          typeof s.icon === 'string' &&
          typeof s.label === 'string',
      );
      if (valid) return parsed;
    }
  } catch {
    // Try to extract JSON from mixed content
    const jsonMatch = cleaned.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.suggestions?.length > 0) return parsed;
      } catch {
        // Fall through to null
      }
    }
  }
  return null;
}

function getStaticFallback(
  type: 'sub_genres' | 'elements',
  genre?: string,
): { suggestions: DynamicItem[] } {
  if (type === 'sub_genres') {
    // Static fallback sub-genres by genre
    const fallbackSubGenres: Record<string, DynamicItem[]> = {
      game: [
        { id: 'rpg', icon: '⚔️', label: 'RPG' },
        { id: 'action', icon: '💥', label: 'アクション' },
        { id: 'puzzle', icon: '🧩', label: 'パズル' },
        { id: 'strategy', icon: '♟', label: 'ストラテジー' },
        { id: 'simulation', icon: '🏙', label: 'シミュレーション' },
        { id: 'adventure', icon: '🌍', label: 'アドベンチャー' },
      ],
      business: [
        { id: 'productivity', icon: '📈', label: '生産性向上' },
        { id: 'communication', icon: '💬', label: 'コミュニケーション' },
        { id: 'finance', icon: '💰', label: '金融・決済' },
        { id: 'project_mgmt', icon: '📋', label: 'プロジェクト管理' },
        { id: 'analytics', icon: '📊', label: '分析・レポート' },
        { id: 'automation', icon: '🤖', label: '自動化' },
      ],
      default: [
        { id: 'social', icon: '👥', label: 'ソーシャル' },
        { id: 'utility', icon: '🔧', label: 'ユーティリティ' },
        { id: 'entertainment', icon: '🎬', label: 'エンターテイメント' },
        { id: 'education', icon: '📚', label: '教育・学習' },
        { id: 'health', icon: '🏥', label: 'ヘルス・フィットネス' },
        { id: 'lifestyle', icon: '🏠', label: 'ライフスタイル' },
      ],
    };
    return {
      suggestions:
        fallbackSubGenres[genre || 'default'] || fallbackSubGenres.default,
    };
  } else {
    // Static fallback elements
    return {
      suggestions: [
        { id: 'ai', icon: '🤖', label: 'AI機能' },
        { id: 'realtime', icon: '⚡', label: 'リアルタイム更新' },
        { id: 'multiplayer', icon: '👥', label: 'マルチプレイヤー' },
        { id: 'auth', icon: '🔐', label: 'ユーザー認証' },
        { id: 'payment', icon: '💳', label: '決済機能' },
        { id: 'notification', icon: '🔔', label: 'プッシュ通知' },
        { id: 'offline', icon: '📵', label: 'オフライン対応' },
        { id: 'social', icon: '💬', label: 'ソーシャル機能' },
        { id: 'analytics', icon: '📊', label: 'アナリティクス' },
        { id: 'upload', icon: '📁', label: 'ファイルアップロード' },
      ],
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestionsRequest = await request.json();
    const { type, genre, subs } = body;

    if (!type || !['sub_genres', 'elements'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be "sub_genres" or "elements"' },
        { status: 400 },
      );
    }

    const systemPrompt =
      type === 'sub_genres'
        ? buildSubGenreSystemPrompt()
        : buildElementSystemPrompt();

    let userMessage = '';
    if (type === 'sub_genres') {
      userMessage = `ジャンル: ${genre || 'general'}`;
    } else {
      userMessage = `ジャンル: ${genre || 'general'}
選択されたサブジャンル: ${subs?.join(', ') || 'なし'}`;
    }

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
        signal: AbortSignal.timeout(30000), // Shorter timeout for suggestions
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.message) {
          const parsed = parseAIResponse(data.message);
          if (parsed) {
            return NextResponse.json(parsed);
          }
          logger.warn(
            'AI response could not be parsed as valid suggestions JSON',
          );
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        logger.warn('Backend AI chat returned error:', errData);
      }
    } catch (aiError) {
      logger.warn(
        'AI generation failed, falling back to static data:',
        aiError,
      );
    }

    // Fallback: return static data
    return NextResponse.json(getStaticFallback(type, genre));
  } catch (error) {
    logger.error('Error generating suggestions:', error);
    return NextResponse.json(
      { error: 'サジェスト生成に失敗しました' },
      { status: 500 },
    );
  }
}
