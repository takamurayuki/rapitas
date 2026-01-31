"use client";

import React, { useMemo, useEffect, useRef } from "react";
import {
  Loader2,
  MessageCircleQuestion,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type {
  StatusCardProps,
  AgentStatusType,
  StatusConfig,
  StatusCardSize,
} from "./types";

/**
 * ステータスごとの設定マップ
 */
const STATUS_CONFIG: Record<AgentStatusType, StatusConfig> = {
  processing: {
    iconColor: "text-blue-500 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/40",
    borderColor: "border-blue-200 dark:border-blue-800",
    textColor: "text-blue-700 dark:text-blue-300",
    label: "実行中",
    animation: "animate-spin",
  },
  waiting_for_input: {
    iconColor: "text-amber-500 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/40",
    borderColor: "border-amber-200 dark:border-amber-800",
    textColor: "text-amber-700 dark:text-amber-300",
    label: "入力待ち",
    animation: "animate-pulse",
  },
  error: {
    iconColor: "text-red-500 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/40",
    borderColor: "border-red-200 dark:border-red-800",
    textColor: "text-red-700 dark:text-red-300",
    label: "エラー",
  },
  completed: {
    iconColor: "text-green-500 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/40",
    borderColor: "border-green-200 dark:border-green-800",
    textColor: "text-green-700 dark:text-green-300",
    label: "完了",
  },
};

/**
 * サイズ設定
 */
const SIZE_CONFIG: Record<
  StatusCardSize,
  { card: string; icon: string; text: string }
> = {
  sm: {
    card: "px-3 py-2 max-h-14",
    icon: "w-4 h-4",
    text: "text-xs",
  },
  md: {
    card: "px-4 py-3 max-h-16",
    icon: "w-5 h-5",
    text: "text-sm",
  },
  lg: {
    card: "px-5 py-4 max-h-20",
    icon: "w-6 h-6",
    text: "text-base",
  },
};

/**
 * デフォルトアイコンの取得
 */
const getDefaultIcon = (
  status: AgentStatusType,
  config: StatusConfig,
  sizeClass: string,
): React.ReactNode => {
  const iconProps = {
    className: `${sizeClass} ${config.iconColor} ${config.animation || ""} flex-shrink-0`,
    "aria-hidden": true as const,
  };

  switch (status) {
    case "processing":
      return <Loader2 {...iconProps} />;
    case "waiting_for_input":
      return <MessageCircleQuestion {...iconProps} />;
    case "error":
      return <AlertCircle {...iconProps} />;
    case "completed":
      return <CheckCircle2 {...iconProps} />;
    default:
      return null;
  }
};

/**
 * StatusCard - AIエージェントのステータス表示コンポーネント
 *
 * 4つのステータス（実行中、入力待ち、エラー、完了）に対応
 */
export const StatusCard: React.FC<StatusCardProps> = ({
  status,
  message,
  size = "md",
  className = "",
  animated = true,
  icon,
  ariaLabel,
  onStatusChange,
}) => {
  const prevStatusRef = useRef<AgentStatusType>(status);
  const cardRef = useRef<HTMLDivElement>(null);

  const config = useMemo(() => STATUS_CONFIG[status], [status]);
  const sizeConfig = useMemo(() => SIZE_CONFIG[size], [size]);

  // ステータス変更時のコールバック
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      onStatusChange?.(status);
      prevStatusRef.current = status;
    }
  }, [status, onStatusChange]);

  // ステータス変更時のアニメーション
  useEffect(() => {
    if (!animated || !cardRef.current) return;

    const card = cardRef.current;
    card.classList.add("status-card-enter");

    const timeout = setTimeout(() => {
      card.classList.remove("status-card-enter");
    }, 300);

    return () => clearTimeout(timeout);
  }, [status, animated]);

  const displayIcon = useMemo(() => {
    if (icon) {
      return (
        <span
          className={`${sizeConfig.icon} ${config.iconColor} flex-shrink-0`}
        >
          {icon}
        </span>
      );
    }
    return getDefaultIcon(status, config, sizeConfig.icon);
  }, [icon, status, config, sizeConfig.icon]);

  const displayMessage = message || config.label;

  return (
    <div
      ref={cardRef}
      role="status"
      aria-label={ariaLabel || `ステータス: ${config.label}`}
      aria-live="polite"
      className={`
        inline-flex items-center gap-3
        ${sizeConfig.card}
        ${config.bgColor}
        ${config.borderColor}
        border rounded-lg
        transition-all duration-300 ease-in-out
        ${animated ? "status-card-animated" : ""}
        ${className}
      `
        .trim()
        .replace(/\s+/g, " ")}
    >
      {displayIcon}
      <div className="flex flex-col min-w-0">
        <span
          className={`
            font-medium ${sizeConfig.text} ${config.textColor}
            truncate
          `
            .trim()
            .replace(/\s+/g, " ")}
        >
          {config.label}
        </span>
        {message && (
          <span
            className={`
              ${sizeConfig.text} text-zinc-600 dark:text-zinc-400
              truncate opacity-80
            `
              .trim()
              .replace(/\s+/g, " ")}
            title={message}
          >
            {displayMessage}
          </span>
        )}
      </div>
    </div>
  );
};

export default StatusCard;
