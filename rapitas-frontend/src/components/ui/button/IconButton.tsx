"use client";
import React from "react";
import { Loader2 } from "lucide-react";

export type IconButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "warning"
  | "ghost";

export type IconButtonSize = "sm" | "md" | "lg";

type Props = {
  onClick?: () => void;
  className?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  "aria-label": string;
};

const variantStyles: Record<IconButtonVariant, string> = {
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
    "bg-transparent hover:bg-zinc-100 text-zinc-600 border-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

const iconSizeStyles: Record<IconButtonSize, string> = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export default function IconButton({
  onClick,
  className = "",
  title,
  type = "button",
  variant = "ghost",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  "aria-label": ariaLabel,
}: Props) {
  const base =
    "inline-flex items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900";

  const disabledStyles =
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

  const renderIcon = (iconElement: React.ReactNode) => {
    if (React.isValidElement(iconElement)) {
      const existingClassName =
        (iconElement.props as { className?: string }).className || "";
      return React.cloneElement(
        iconElement as React.ReactElement<{ className?: string }>,
        {
          className: `${iconSizeStyles[size]} ${existingClassName}`.trim(),
        }
      );
    }
    return iconElement;
  };

  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      className={`${base} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${className}`}
    >
      {loading ? (
        <Loader2 className={`${iconSizeStyles[size]} animate-spin`} />
      ) : (
        renderIcon(icon)
      )}
    </button>
  );
}

// Named export for convenience
export { IconButton };
