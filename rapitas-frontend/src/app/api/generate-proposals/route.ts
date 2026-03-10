import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GenerateProposalsRoute');

interface ProposalRequest {
  genre: string;
  subs: string;
  elems: string;
  plat: string;
  scale: string;
  prio: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ProposalRequest = await request.json();
    const { genre, subs, elems, plat, scale, prio } = body;

    const systemPrompt = `あなたはプロダクトデザイナーです。ユーザーの選択から、具体的なアプリのコンセプトを3案提案してください。

出力形式（JSONのみ・説明文不要）:
{
  "proposals": [
    {
      "id": "A",
      "name": "アプリ名（キャッチーで短い）",
      "tagline": "一言キャッチコピー（20字以内）",
      "concept": "どんなアプリか（60〜80字）",
      "unique": "このアプリならではの独自機能・差別化ポイント（40字以内）",
      "difficulty": "easy|medium|hard",
      "tech_hint": "主要技術スタックのヒント（3〜4個）"
    }
  ]
}

## ルール
- 3案はそれぞれ方向性を変える（シンプル案・機能豊富案・ニッチ特化案 など）
- 選択された要素を最大限に活かしたリアルなプロダクトを提案
- アプリ名は日本語でも英語でもOK、ユニークで記憶に残るもの
- 実現可能な現実的な提案にする
- JSONのみ出力`;

    const userMessage = `ジャンル: ${genre}\nサブジャンル: ${subs}\n追加要素: ${elems}\nプラットフォーム: ${plat}\n規模: ${scale}\n優先事項: ${prio}`;

    // 実際のClaude APIの代わりに、モックデータを返します
    // 本格実装時はここでClaude APIを呼び出します
    const mockResponse = {
      proposals: [
        {
          id: 'A',
          name: 'TaskFlow',
          tagline: '直感的なタスク管理',
          concept:
            'シンプルなインターフェースで日々のタスクを効率的に管理できるアプリ。ドラッグ&ドロップでタスクを整理し、進捗を可視化します。',
          unique: 'AIによる優先度自動判定とスマートな時間配分提案',
          difficulty: 'easy',
          tech_hint: ['Next.js', 'Supabase', 'Tailwind CSS', 'Framer Motion'],
        },
        {
          id: 'B',
          name: 'CollabSpace',
          tagline: 'チーム協働の新体験',
          concept:
            'リアルタイム同期機能付きのチーム協働プラットフォーム。プロジェクト管理からファイル共有まで一元管理できます。',
          unique: 'バーチャル共同作業空間とAIアシスタント機能',
          difficulty: 'medium',
          tech_hint: ['Next.js', 'Socket.io', 'PostgreSQL', 'AWS S3'],
        },
        {
          id: 'C',
          name: 'FocusZone',
          tagline: '集中力最大化ツール',
          concept:
            'ポモドーロテクニックとバイオリズム分析を組み合わせた集中力向上アプリ。個人の最適な作業パターンを学習します。',
          unique: '生体データ連携による個人最適化された集中セッション',
          difficulty: 'hard',
          tech_hint: [
            'React Native',
            'Machine Learning',
            'Firebase',
            'HealthKit',
          ],
        },
      ],
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    logger.error('Error generating proposals:', error);
    return NextResponse.json(
      { error: 'プロポーザルの生成に失敗しました' },
      { status: 500 },
    );
  }
}
