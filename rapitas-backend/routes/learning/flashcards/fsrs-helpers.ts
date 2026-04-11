/**
 * FsrsHelpers
 *
 * Utility functions and type helpers for the FSRS (Free Spaced Repetition Scheduler)
 * algorithm used by the flashcard review system.
 *
 * Not responsible for database access or HTTP routing.
 */

import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';

/** Shared FSRS scheduler instance, configured with default parameters. */
export const f = fsrs(generatorParameters());

/**
 * Maps an SM-2 quality rating (0–5) to an FSRS Grade (1–4).
 *
 * @param quality - SM-2 quality value (0–5) / SM-2品質値（0〜5）
 * @returns FSRS Grade enum value / FSRS Gradeの列挙値
 */
export function qualityToRating(quality: number): Grade {
  if (quality <= 1) return Rating.Again; // 1
  if (quality === 2) return Rating.Hard; // 2
  if (quality === 3) return Rating.Good; // 3
  return Rating.Easy; // 4
}

/**
 * Database flashcard fields required for FSRS Card construction.
 */
export interface DbCardFields {
  stability: number;
  difficulty: number;
  state: number;
  reviewCount: number;
  lapses: number;
  lastReview: Date | null;
  nextReview: Date | null;
  interval: number;
  easeFactor: number;
}

/**
 * Converts a database flashcard record to an FSRS Card object.
 * Returns an empty card for brand-new cards (state=0, stability=0).
 *
 * @param dbCard - Database flashcard fields / DBフラッシュカードフィールド
 * @returns FSRS Card object / FSRSカードオブジェクト
 */
export function toFsrsCard(dbCard: DbCardFields): Card {
  // For new cards (state=0, stability=0), return empty card
  if (dbCard.state === 0 && dbCard.stability === 0) {
    return createEmptyCard();
  }

  return {
    due: dbCard.nextReview || new Date(),
    stability: dbCard.stability,
    difficulty: dbCard.difficulty,
    elapsed_days: 0,
    scheduled_days: dbCard.interval,
    reps: dbCard.reviewCount,
    lapses: dbCard.lapses,
    learning_steps: 0,
    state: dbCard.state as State,
    last_review: dbCard.lastReview || undefined,
  };
}

/**
 * Return flashcard generation guidelines based on difficulty level.
 *
 * @param difficulty - Difficulty tier / 難易度レベル
 * @param language - Output language / 出力言語
 * @returns Guideline text for the AI prompt / AIプロンプト用ガイドラインテキスト
 */
export function getDifficultyGuidelines(difficulty: string, language: string): string {
  if (language === 'ja') {
    switch (difficulty) {
      case 'beginner':
        return `- 難易度: 初級
- カード形式: 用語・キーワード → 短い定義（1〜2文、50文字以内）
- 「〜とは？」「〜の意味は？」のようなシンプルな質問
- 回答は暗記しやすい端的な表現にする（長い説明は不要）
- 例: front「HTTP」→ back「Webブラウザとサーバー間の通信プロトコル」`;
      case 'advanced':
        return `- 難易度: 上級
- カード形式: 応用・比較・分析の問題 → 論理的な回答（3〜4文、150文字以内）
- 「なぜ〜か」「〜と〜の違いを実務の観点で説明せよ」のような深い質問
- 回答は根拠や理由を含むが、冗長にならないこと
- 例: front「RESTとGraphQLの使い分け基準は？」→ back「データ取得パターンが固定的ならREST、クライアントごとに異なるデータ要件があればGraphQLが適する。RESTは…」`;
      default: // intermediate
        return `- 難易度: 中級
- カード形式: 概念・仕組み → 簡潔な説明（2〜3文、100文字以内）
- 「〜の仕組みは？」「〜のメリットは？」のような理解を問う質問
- 回答は要点を絞り、核心だけを述べる
- 例: front「RESTful APIとは？」→ back「HTTPメソッドでリソースを操作するAPI設計。URLでリソースを特定し、GET/POST/PUT/DELETEで操作する」`;
    }
  } else {
    switch (difficulty) {
      case 'beginner':
        return `- Difficulty: Beginner
- Card format: Term/keyword → Short definition (1-2 sentences, under 50 words)
- Use simple "What is...?" style questions
- Answers should be brief and memorizable (no long explanations)
- Example: front "HTTP" → back "A protocol for communication between web browsers and servers"`;
      case 'advanced':
        return `- Difficulty: Advanced
- Card format: Applied/analytical questions → Reasoned answers (3-4 sentences, under 100 words)
- Use "Why...?", "Compare... in practice" style questions
- Answers should include reasoning but stay concise
- Example: front "When to use REST vs GraphQL?" → back "Use REST when data access patterns are predictable. Use GraphQL when clients need different data shapes..."`;
      default: // intermediate
        return `- Difficulty: Intermediate
- Card format: Concept/mechanism → Concise explanation (2-3 sentences, under 70 words)
- Use "How does...work?", "What are the benefits of...?" style questions
- Answers should focus on key points only
- Example: front "What is a RESTful API?" → back "An API design using HTTP methods to operate on resources. URLs identify resources, and GET/POST/PUT/DELETE perform operations"`;
    }
  }
}

/**
 * Shape of a successful Claude API response.
 */
export interface ClaudeAPIResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
