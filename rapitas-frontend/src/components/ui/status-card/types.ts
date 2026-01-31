/**
 * AIエージェントのステータス種別
 */
export type AgentStatusType =
  | "processing"
  | "waiting_for_input"
  | "error"
  | "completed";

/**
 * ステータスカードのサイズ
 */
export type StatusCardSize = "sm" | "md" | "lg";

/**
 * ステータスカードのテーマ
 */
export type StatusCardTheme = "light" | "dark" | "auto";

/**
 * ステータスの設定情報
 */
export type StatusConfig = {
  /** アイコンの色クラス */
  iconColor: string;
  /** 背景色クラス */
  bgColor: string;
  /** ボーダー色クラス */
  borderColor: string;
  /** テキスト色クラス */
  textColor: string;
  /** ステータスラベル */
  label: string;
  /** アニメーションクラス（オプション） */
  animation?: string;
};

/**
 * StatusCardコンポーネントのプロパティ
 */
export type StatusCardProps = {
  /** ステータス種別 */
  status: AgentStatusType;
  /** 表示メッセージ（オプション） */
  message?: string;
  /** カードサイズ */
  size?: StatusCardSize;
  /** テーマ */
  theme?: StatusCardTheme;
  /** カスタムクラス名 */
  className?: string;
  /** ステータス変更時のコールバック */
  onStatusChange?: (status: AgentStatusType) => void;
  /** アニメーション有効化 */
  animated?: boolean;
  /** カスタムアイコン（オプション） */
  icon?: React.ReactNode;
  /** aria-label（アクセシビリティ） */
  ariaLabel?: string;
};
