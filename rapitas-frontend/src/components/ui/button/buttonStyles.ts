/**
 * ボタンコンポーネント共通スタイル定義
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "warning"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

/**
 * バリアントスタイル - Button, IconButton で共有
 */
export const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-purple-600 hover:bg-purple-700 text-white border-transparent dark:bg-purple-600 dark:hover:bg-purple-500",
  secondary:
    "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-700",
  success:
    "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent dark:bg-emerald-600 dark:hover:bg-emerald-500",
  danger:
    "bg-red-600 hover:bg-red-700 text-white border-transparent dark:bg-red-600 dark:hover:bg-red-500",
  warning:
    "bg-amber-500 hover:bg-amber-600 text-white border-transparent dark:bg-amber-500 dark:hover:bg-amber-400",
  ghost:
    "bg-transparent hover:bg-zinc-100 text-zinc-700 border-transparent dark:text-zinc-300 dark:hover:bg-zinc-800",
};

/**
 * ghost バリアントの IconButton 用スタイル（テキスト色が若干異なる）
 */
export const iconButtonGhostStyle =
  "bg-transparent hover:bg-zinc-100 text-zinc-600 border-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

/**
 * サイズスタイル - Button 用
 */
export const buttonSizeStyles: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-base gap-2.5",
};

/**
 * サイズスタイル - IconButton 用
 */
export const iconButtonSizeStyles: Record<ButtonSize, string> = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

/**
 * アイコンサイズスタイル - Button 用
 */
export const buttonIconSizeStyles: Record<ButtonSize, string> = {
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

/**
 * アイコンサイズスタイル - IconButton 用
 */
export const iconButtonIconSizeStyles: Record<ButtonSize, string> = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

/**
 * 無効状態のスタイル
 */
export const disabledStyles =
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";
