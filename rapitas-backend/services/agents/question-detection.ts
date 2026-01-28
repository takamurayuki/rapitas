/**
 * 質問判定システム - キーベース判定方式
 *
 * AIエージェントからの質問を構造化されたキーフォーマットで判定・管理する
 * パターンマッチングから特定キー返却方式への移行を実現
 */

// ==================== 型定義 ====================

/**
 * 質問の状態を表すステータス
 */
export type QuestionStatus =
  | "awaiting_user_input" // ユーザーの入力待ち
  | "processing" // 処理中
  | "completed"; // 完了

/**
 * 質問のタイプ（意味的分類）
 */
export type QuestionCategory =
  | "clarification" // 要件の明確化
  | "confirmation" // 確認（Yes/No）
  | "selection"; // 選択肢からの選択

/**
 * 質問検出の方法（技術的分類）
 * 後方互換性のため既存のQuestionTypeを維持
 */
export type QuestionDetectionMethod = "tool_call" | "key_based" | "none";

/**
 * 質問の構造化キーフォーマット
 * AIエージェントが返却する特定キー形式
 */
export type QuestionKey = {
  /** 質問の状態 */
  status: QuestionStatus;
  /** 質問の一意識別子 */
  question_id: string;
  /** 質問のタイプ（意味的分類） */
  question_type: QuestionCategory;
  /** ユーザー応答が必要かどうか */
  requires_response: boolean;
  /** タイムアウト秒数（オプション） */
  timeout_seconds?: number;
};

/**
 * 質問の詳細情報
 * 選択肢やヘッダーなどのUI表示用情報
 */
export type QuestionDetails = {
  /** 質問のヘッダー（短いラベル） */
  headers?: string[];
  /** 選択肢がある場合の選択肢リスト */
  options?: Array<{
    label: string;
    description?: string;
  }>;
  /** 複数選択が可能かどうか */
  multiSelect?: boolean;
};

/**
 * 質問検出結果
 * 検出ロジックの出力形式
 */
export type QuestionDetectionResult = {
  /** 質問が検出されたか */
  hasQuestion: boolean;
  /** 質問テキスト */
  questionText: string;
  /** 構造化キー情報 */
  questionKey?: QuestionKey;
  /** 質問の詳細情報 */
  questionDetails?: QuestionDetails;
  /** 検出方法 */
  detectionMethod: QuestionDetectionMethod;
};

/**
 * 質問待機状態
 * 質問検出後の状態管理用
 */
export type QuestionWaitingState = {
  /** 質問が存在するか */
  hasQuestion: boolean;
  /** 質問テキスト */
  question: string;
  /** 検出方法（後方互換性のため維持） */
  questionType: QuestionDetectionMethod;
  /** 質問の詳細情報 */
  questionDetails?: QuestionDetails;
  /** 構造化キー情報（新方式） */
  questionKey?: QuestionKey;
};

// ==================== ユーティリティ関数 ====================

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
  input: Record<string, unknown> | undefined
): QuestionCategory {
  if (!input) {
    return "clarification";
  }

  // questionsフィールドを確認
  const questions = input.questions as Array<{
    options?: unknown[];
    multiSelect?: boolean;
    question?: string;
  }> | undefined;

  if (questions && Array.isArray(questions) && questions.length > 0) {
    const firstQuestion = questions[0];

    // 選択肢がある場合は selection
    if (firstQuestion?.options && Array.isArray(firstQuestion.options) && firstQuestion.options.length > 0) {
      return "selection";
    }

    // 質問テキストに確認系のキーワードが含まれる場合は confirmation
    const questionText = firstQuestion?.question || "";
    const confirmationKeywords = [
      "よろしいですか",
      "してもいいですか",
      "しますか",
      "続けますか",
      "確認",
      "proceed",
      "continue",
      "confirm",
      "ok",
      "yes",
      "no",
    ];

    const isConfirmation = confirmationKeywords.some((keyword) =>
      questionText.toLowerCase().includes(keyword.toLowerCase())
    );

    if (isConfirmation) {
      return "confirmation";
    }
  }

  // デフォルトは clarification
  return "clarification";
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
    return { questionText: "" };
  }

  let questionText = "";
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
      .map((q) => q.question || q.header || "")
      .filter((q) => q)
      .join("\n");

    // ヘッダーを抽出
    const headers = questions
      .map((q) => q.header)
      .filter((h): h is string => !!h);
    if (headers.length > 0) {
      questionDetails.headers = headers;
    }

    // 最初の質問から選択肢とmultiSelectを取得
    const firstQuestion = questions[0];
    if (firstQuestion) {
      if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
        questionDetails.options = firstQuestion.options.map((opt) => ({
          label: opt.label || "",
          description: opt.description,
        }));
      }
      if (typeof firstQuestion.multiSelect === "boolean") {
        questionDetails.multiSelect = firstQuestion.multiSelect;
      }
    }
  }
  // 単一のquestionフィールドがある場合
  else if (input.question && typeof input.question === "string") {
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
  timeoutSeconds?: number
): QuestionKey {
  return {
    status: "awaiting_user_input",
    question_id: generateQuestionId(),
    question_type: inferQuestionCategory(input),
    requires_response: true,
    timeout_seconds: timeoutSeconds,
  };
}

/**
 * 質問検出結果を生成
 * AskUserQuestionツール呼び出しから完全な検出結果を構築
 */
export function detectQuestionFromToolCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  timeoutSeconds?: number
): QuestionDetectionResult {
  // AskUserQuestion以外のツールは質問なし
  if (toolName !== "AskUserQuestion") {
    return {
      hasQuestion: false,
      questionText: "",
      detectionMethod: "none",
    };
  }

  // 質問情報を抽出
  const { questionText, questionDetails } = extractQuestionInfo(input);

  // 構造化キーを生成
  const questionKey = createQuestionKeyFromToolCall(input, timeoutSeconds);

  return {
    hasQuestion: true,
    questionText: questionText || "ユーザーの入力を待っています",
    questionKey,
    questionDetails,
    detectionMethod: "tool_call",
  };
}

/**
 * 質問待機状態を初期化
 */
export function createInitialWaitingState(): QuestionWaitingState {
  return {
    hasQuestion: false,
    question: "",
    questionType: "none",
  };
}

/**
 * 質問検出結果から待機状態を更新
 */
export function updateWaitingStateFromDetection(
  result: QuestionDetectionResult
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

// ==================== 後方互換性レイヤー ====================

/**
 * 既存のQuestionType型との互換性を維持
 * 'tool_call' | 'none' を返す
 */
export function tolegacyQuestionType(
  method: QuestionDetectionMethod
): "tool_call" | "none" {
  if (method === "tool_call" || method === "key_based") {
    return "tool_call";
  }
  return "none";
}

/**
 * 既存のAgentExecutionResult形式に変換
 */
export function toExecutionResultFormat(state: QuestionWaitingState): {
  waitingForInput: boolean;
  question?: string;
  questionType: "tool_call" | "none";
  questionDetails?: QuestionDetails;
} {
  return {
    waitingForInput: state.hasQuestion,
    question: state.hasQuestion ? state.question : undefined,
    questionType: tolegacyQuestionType(state.questionType),
    questionDetails: state.questionDetails,
  };
}

// ==================== バリデーション ====================

/**
 * QuestionKeyの妥当性を検証
 */
export function validateQuestionKey(key: unknown): key is QuestionKey {
  if (!key || typeof key !== "object") {
    return false;
  }

  const obj = key as Record<string, unknown>;

  // 必須フィールドの存在チェック
  if (
    typeof obj.status !== "string" ||
    typeof obj.question_id !== "string" ||
    typeof obj.question_type !== "string" ||
    typeof obj.requires_response !== "boolean"
  ) {
    return false;
  }

  // status値の検証
  const validStatuses = ["awaiting_user_input", "processing", "completed"];
  if (!validStatuses.includes(obj.status)) {
    return false;
  }

  // question_type値の検証
  const validTypes = ["clarification", "confirmation", "selection"];
  if (!validTypes.includes(obj.question_type)) {
    return false;
  }

  // timeout_secondsがある場合は数値であることを確認
  if (obj.timeout_seconds !== undefined && typeof obj.timeout_seconds !== "number") {
    return false;
  }

  return true;
}

/**
 * 文字列からQuestionKeyをパース（将来の直接キー返却方式用）
 */
export function parseQuestionKeyFromString(str: string): QuestionKey | null {
  try {
    const parsed = JSON.parse(str);
    if (validateQuestionKey(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * オブジェクトからQuestionKeyを抽出（将来の直接キー返却方式用）
 */
export function extractQuestionKeyFromObject(obj: Record<string, unknown>): QuestionKey | null {
  // オブジェクト自体がQuestionKeyの場合
  if (validateQuestionKey(obj)) {
    return obj;
  }

  // ネストされた場所にある場合を探索
  const possibleLocations = ["questionKey", "question_key", "key", "response"];
  for (const loc of possibleLocations) {
    if (obj[loc] && validateQuestionKey(obj[loc])) {
      return obj[loc] as QuestionKey;
    }
  }

  return null;
}
