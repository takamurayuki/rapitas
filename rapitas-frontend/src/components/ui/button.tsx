"use client";
import React from "react";

type Props = {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  variant?: "default" | "primary" | "danger" | "ghost";
  type?: "button" | "submit" | "reset";
};

export default function Button({
  onClick,
  children,
  className = "",
  title,
  variant = "default",
  type = "button",
}: Props) {
  const base =
    "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors";
  const variants: Record<string, string> = {
    default:
      "text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700",
    primary: "text-white bg-blue-600 hover:bg-blue-700",
    danger: "text-white bg-red-600 hover:bg-red-700",
    ghost:
      "text-zinc-600 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      className={`${base} ${variants[variant] ?? variants.default} ${className}`}
    >
      {children}
    </button>
  );
}
