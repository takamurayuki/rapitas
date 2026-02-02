"use client";
import React from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "warning"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

type Props = {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
};

const variantStyles: Record<ButtonVariant, string> = {
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

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-base gap-2.5",
};

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

export default function Button({
  onClick,
  children,
  className = "",
  title,
  type = "button",
  variant = "secondary",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  iconPosition = "left",
  fullWidth = false,
}: Props) {
  const base =
    "inline-flex items-center justify-center font-medium rounded-lg border";

  const disabledStyles =
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

  const widthStyle = fullWidth ? "w-full" : "";

  const renderIcon = (iconElement: React.ReactNode) => {
    if (React.isValidElement(iconElement)) {
      const existingClassName =
        (iconElement.props as { className?: string }).className || "";
      return React.cloneElement(
        iconElement as React.ReactElement<{ className?: string }>,
        {
          className: `${iconSizeStyles[size]} ${existingClassName}`.trim(),
        },
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
      className={`${base} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${widthStyle} ${className}`}
    >
      {loading && (
        <Loader2 className={`${iconSizeStyles[size]} animate-spin`} />
      )}
      {!loading && icon && iconPosition === "left" && renderIcon(icon)}
      {children}
      {!loading && icon && iconPosition === "right" && renderIcon(icon)}
    </button>
  );
}

// Named export for convenience
export { Button };
