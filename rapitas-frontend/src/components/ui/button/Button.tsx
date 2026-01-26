"use client";
import React from "react";

type Props = {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
};

export default function Button({
  onClick,
  children,
  className = "",
  title,
  type = "button",
}: Props) {
  const base =
    "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors";

  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      className={`${base} ${className}`}
    >
      {children}
    </button>
  );
}
