"use client";
import React from "react";

export type ToggleButtonColor =
  | "violet"
  | "blue"
  | "emerald"
  | "red"
  | "amber"
  | "zinc";

type ToggleButtonProps = {
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: ToggleButtonColor;
  isEnabled: boolean;
  isLoading?: boolean;
  onToggle: () => void;
};

const enabledStyles: Record<ToggleButtonColor, string> = {
  violet:
    "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  emerald:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700",
  red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
  amber:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  zinc: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600",
};

const enabledIconStyles: Record<ToggleButtonColor, string> = {
  violet: "text-violet-600 dark:text-violet-400",
  blue: "text-blue-600 dark:text-blue-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  zinc: "text-zinc-600 dark:text-zinc-400",
};

const enabledBadgeStyles: Record<ToggleButtonColor, string> = {
  violet:
    "bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-200",
  blue: "bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-200",
  emerald:
    "bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-200",
  red: "bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-200",
  amber: "bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200",
  zinc: "bg-zinc-300 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-200",
};

export function ToggleButton({
  label,
  description,
  icon: Icon,
  color = "violet",
  isEnabled,
  isLoading,
  onToggle,
}: ToggleButtonProps) {
  const disabledStyles =
    "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700";

  const disabledBadgeStyles =
    "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400";

  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
        isEnabled ? enabledStyles[color] : disabledStyles
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      title={description}
    >
      <Icon
        className={`w-4 h-4 ${isEnabled ? enabledIconStyles[color] : ""}`}
      />
      <span>{label}</span>
      <span
        className={`px-1.5 py-0.5 rounded text-xs ${
          isEnabled ? enabledBadgeStyles[color] : disabledBadgeStyles
        }`}
      >
        {isEnabled ? "ON" : "OFF"}
      </span>
    </button>
  );
}
