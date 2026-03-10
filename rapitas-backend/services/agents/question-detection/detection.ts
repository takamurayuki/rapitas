/**
 * 質問判定システム - コア検出ロジック
 *
 * AIエージェントからの質問を構造化されたキーフォーマットで判定・管理する
 */

import type {
  QuestionCategory,
  QuestionDetails,
  QuestionDetectionResult,
  QuestionKey,
  QuestionWaitingState,
} from './types';
import { normalizeTimeoutSeconds } from './timeout';

/**
 * 一意の質問IDを生成
 */
export function generateQuestionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `q_${timestamp}_${random}`;
}

/**
 * AskUserQuestionツールの入力から質問カテゴリを推測
 */
export function inferQuestionCategory(
  input: Record<string, unknown> | undefined,
): QuestionCategory {
  if (!input) {
    return 'clarification';
  }

  // questionsフィールドを確認
  const questions = input.questions as
    | Array<{
        options?: unknown[];
        multiSelect?: boolean;
        question?: string;
      }>
    | undefined;

  if (questions && Array.isArray(questions) && questions.length > 0) {
    const firstQuestion = questions[0];

    // 選択肢がある場合は selection
    if (
      firstQuestion?.options &&
      Array.isArray(firstQuestion.options) &&
      firstQuestion.options.length > 0
    ) {
      return 'selection';
    }

    // 質問テキストに確認系のキーワードが含まれる場合は confirmation
    const questionText = firstQuestion?.question || '';
    const confirmationKeywords = [
      'よろしいですか',
      'してもいいですか',
      'しますか',
      '続けますか',
      '確認',
      'proceed',
      'continue',
      'confirm',
      'ok',
      'yes',
      'no',
    ];

    const isConfirmation = confirmationKeywords.some((keyword) =>
      questionText.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (isConfirmation) {
      return 'confirmation';
    }
  }

  // デフォルトは clarification
  return 'clarification';
}

/**
 * AskUserQuestionツールの入力から質問情報を抽出
 * 既存のClaudeCodeAgent.extractQuestionInfoメソッドと互換性を維持
 */
export function extractQuestionInfo(input: Record<string, unknown> | undefined): {
  questionText: string;
  questionDetails?: QuestionDetails;
} {
  if (!input) {
    return { questionText: '' };
  }

  let questionText = '';
  const questionDetails: QuestionDetails = {};

  // questionsフィールドがある場合（配列形式）
  if (input.questions && Array.isArray(input.questions)) {
    const questions = input.questions as Array<{
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;

    // 質問テキストを抽出
    questionText = questions
      .map((q) => q.question || q.header || '')
      .filter((q) => q)
      .join('\n');

    // ヘッダーを抽出
    const headers = questions.map((q) => q.header).filter((h): h is string => !!h);
    if (headers.length > 0) {
      questionDetails.headers = headers;
    }

    // 最初の質問から選択肢とmultiSelectを取得
    const firstQuestion = questions[0];
    if (firstQuestion) {
      if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
        questionDetails.options = firstQuestion.options.map((opt) => ({
          label: opt.label || '',
          description: opt.description,
        }));
      }
      if (typeof firstQuestion.multiSelect === 'boolean') {
        questionDetails.multiSelect = firstQuestion.multiSelect;
      }
    }
  }
  // 単一のquestionフィールドがある場合
  else if (input.question && typeof input.question === 'string') {
    questionText = input.question;
  }

  // questionDetailsが空でなければ返す
  const hasDetails =
    questionDetails.headers?.length ||
    questionDetails.options?.length ||
    questionDetails.multiSelect !== undefined;

  return {
    questionText,
    questionDetails: hasDetails ? questionDetails : undefined,
  };
}

/**
 * AskUserQuestionツール呼び出しから構造化キーを生成
 */
export function createQuestionKeyFromToolCall(
  input: Record<string, unknown> | undefined,
  timeoutSeconds?: number,
): QuestionKey {
  // タイムアウト秒数を正規化（範囲内に収める）
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);

  return {
    status: 'awaiting_user_input',
    question_id: generateQuestionId(),
    question_type: inferQuestionCategory(input),
    requires_response: true,
    timeout_seconds: normalizedTimeout,
  };
}

/**
 * 質問検出結果を生成
 * AskUserQuestionツール呼び出しから完全な検出結果を構築
 */
export function detectQuestionFromToolCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  timeoutSeconds?: number,
): QuestionDetectionResult {
  // AskUserQuestion以外のツールは質問なし
  if (toolName !== 'AskUserQuestion') {
    return {
      hasQuestion: false,
      questionText: '',
      detectionMethod: 'none',
    };
  }

  // 質問情報を抽出
  const { questionText, questionDetails } = extractQuestionInfo(input);

  // 構造化キーを生成
  const questionKey = createQuestionKeyFromToolCall(input, timeoutSeconds);

  return {
    hasQuestion: true,
    questionText: questionText || 'ユーザーの入力を待っています',
    questionKey,
    questionDetails,
    detectionMethod: 'tool_call',
  };
}

/**
 * 質問待機状態を初期化
 */
export function createInitialWaitingState(): QuestionWaitingState {
  return {
    hasQuestion: false,
    question: '',
    questionType: 'none',
  };
}

/**
 * 質問検出結果から待機状態を更新
 */
export function updateWaitingStateFromDetection(
  result: QuestionDetectionResult,
): QuestionWaitingState {
  if (!result.hasQuestion) {
    return createInitialWaitingState();
  }

  return {
    hasQuestion: true,
    question: result.questionText,
    questionType: result.detectionMethod,
    questionDetails: result.questionDetails,
    questionKey: result.questionKey,
  };
}
