/**
 * AIエージェント抽象化レイヤー - エージェント識別・基本型定義
 */

/**
 * エージェントの種類を識別するID
 */
export type AgentProviderId =
  | 'claude-code'    // Claude Code CLI
  | 'openai-codex'   // OpenAI Codex API
  | 'gemini'         // Google Gemini API
  | 'google-gemini'  // Gemini CLI
  | 'anthropic-api'  // Anthropic Messages API (直接)
  | 'custom';        // カスタム実装

/**
 * エージェントの実行状態
 */
export type AgentState =
  | 'idle'              // 待機中
  | 'initializing'      // 初期化中
  | 'running'           // 実行中
  | 'waiting_for_input' // ユーザー入力待ち
  | 'paused'            // 一時停止中
  | 'completing'        // 完了処理中
  | 'completed'         // 完了
  | 'failed'            // 失敗
  | 'cancelled'         // キャンセル
  | 'timeout';          // タイムアウト

/**
 * エージェントの能力定義
 */
export interface AgentCapabilities {
  // コア機能
  codeGeneration: boolean;      // コード生成
  codeReview: boolean;          // コードレビュー
  codeExecution: boolean;       // コード実行

  // ファイル操作
  fileRead: boolean;            // ファイル読み取り
  fileWrite: boolean;           // ファイル書き込み
  fileEdit: boolean;            // ファイル編集（差分適用）

  // 外部連携
  terminalAccess: boolean;      // ターミナル/シェルアクセス
  gitOperations: boolean;       // Git操作
  webSearch: boolean;           // Web検索
  webFetch: boolean;            // Webページ取得

  // タスク管理
  taskAnalysis: boolean;        // タスク分析・分解
  taskPlanning: boolean;        // 実行計画作成
  parallelExecution: boolean;   // 並列実行サポート

  // 対話機能
  questionAsking: boolean;      // ユーザーへの質問
  conversationMemory: boolean;  // 会話履歴の保持
  sessionContinuation: boolean; // セッション継続

  // 追加のカスタム能力
  [key: string]: boolean | undefined;
}

/**
 * エージェントのメタ情報
 */
export interface AgentMetadata {
  id: string;                   // ユニークID
  providerId: AgentProviderId;  // プロバイダーID
  name: string;                 // 表示名
  version?: string;             // バージョン
  description?: string;         // 説明
  modelId?: string;             // 使用モデルID
  endpoint?: string;            // APIエンドポイント
  createdAt: Date;              // 作成日時
  lastUsedAt?: Date;            // 最終使用日時
}