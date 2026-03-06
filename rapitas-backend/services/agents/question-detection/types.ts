/**
 * 質問判定システム - 型定義
 *
 * 質問検出・管理で使用する型、インターフェース、列挙型を定義
 */

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
