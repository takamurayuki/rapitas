/**
 * AiPrompts
 *
 * Builds the bilingual Claude prompt strings used by the AI flashcard
 * generation routes. Keeping prompt text in a dedicated module prevents
 * route files from exceeding the 300-line limit.
 *
 * Not responsible for HTTP routing or API calls.
 */

import { getDifficultyGuidelines } from './fsrs-helpers';

/**
 * Builds the prompt for topic-based flashcard generation.
 *
 * @param topic - Subject topic / 対象トピック
 * @param count - Number of cards to generate / 生成するカード枚数
 * @param difficulty - Difficulty level / 難易度レベル
 * @param language - Output language ('ja' | 'en') / 出力言語
 * @returns Claude prompt string / Claudeプロンプト文字列
 */
export function buildTopicPrompt(
  topic: string,
  count: number,
  difficulty: string,
  language: string,
): string {
  if (language === 'ja') {
    return `「${topic}」に関するフラッシュカードを${count}枚作成してください。

【重要】フラッシュカード設計原則：
- 1枚のカードには1つの概念のみ（最小情報原則）
- 回答は短く端的に。長い説明文は書かない
- 暗記・復習に適した形式にする

条件：
${getDifficultyGuidelines(difficulty, language)}
- 段階的に難しくなるように配置

以下のJSON形式で出力してください：
{"cards":[{"front":"質問内容","back":"回答内容"}]}`;
  }

  return `Create ${count} flashcards about "${topic}".

IMPORTANT - Flashcard design principles:
- One concept per card (minimum information principle)
- Keep answers short and direct. Do NOT write long explanations
- Format for memorization and review

Requirements:
${getDifficultyGuidelines(difficulty, language)}
- Arrange cards progressively from easier to harder

Output in the following JSON format:
{"cards":[{"front":"Question text","back":"Answer text"}]}`;
}

/**
 * Builds the prompt for note-text flashcard generation.
 *
 * @param plainText - Sanitised, truncated source text / サニタイズ済み・切り詰め済みのソーステキスト
 * @param count - Number of cards to generate / 生成するカード枚数
 * @param difficulty - Difficulty level / 難易度レベル
 * @param language - Output language ('ja' | 'en') / 出力言語
 * @returns Claude prompt string / Claudeプロンプト文字列
 */
export function buildTextPrompt(
  plainText: string,
  count: number,
  difficulty: string,
  language: string,
): string {
  if (language === 'ja') {
    return `以下のテキストからフラッシュカードを${count}枚作成してください。

テキスト内容の重要な概念、用語、事実を抽出し、学習に最適なQ&Aペアを作成してください。

【重要】フラッシュカード設計原則：
- 1枚のカードには1つの概念のみ（最小情報原則）
- 回答は短く端的に。長い説明文は書かない
- 暗記・復習に適した形式にする

条件：
- テキストに含まれる情報のみを使用（外部知識は最小限に）
${getDifficultyGuidelines(difficulty, language)}
- 段階的に基礎→応用の順で並べる

以下のJSON形式のみで出力（余計なテキスト不要）：
{"cards":[{"front":"質問","back":"回答"}]}

テキスト：
${plainText}`;
  }

  return `Create ${count} flashcards from the following text.

Extract key concepts, terms, and facts from the text and create optimal Q&A pairs for learning.

IMPORTANT - Flashcard design principles:
- One concept per card (minimum information principle)
- Keep answers short and direct. Do NOT write long explanations
- Format for memorization and review

Requirements:
- Use only information from the text (minimize external knowledge)
${getDifficultyGuidelines(difficulty, language)}
- Order from basic to advanced concepts

Output ONLY in the following JSON format (no extra text):
{"cards":[{"front":"Question","back":"Answer"}]}

Text:
${plainText}`;
}

/**
 * Strips HTML markup and truncates text to stay within Claude's token budget.
 *
 * @param rawHtml - Raw HTML string (e.g. from a rich-text editor) / リッチテキストエディタ等からの生HTML文字列
 * @param maxChars - Maximum character length after sanitisation (default 8000) / サニタイズ後の最大文字数（デフォルト8000）
 * @returns Plain text truncated to maxChars / maxCharsに切り詰めたプレーンテキスト
 */
export function sanitiseAndTruncate(rawHtml: string, maxChars = 8000): string {
  return rawHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}
