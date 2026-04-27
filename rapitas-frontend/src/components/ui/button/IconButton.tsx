'use client';
import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  type ButtonVariant,
  type ButtonSize,
  variantStyles,
  iconButtonGhostStyle,
  iconButtonSizeStyles,
  iconButtonIconSizeStyles,
  disabledStyles,
} from './button-styles';

export type IconButtonVariant = ButtonVariant;
export type IconButtonSize = ButtonSize;

type Props = {
  onClick?: () => void;
  className?: string;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  'aria-label': string;
};

export default function IconButton({
  onClick,
  className = '',
  title,
  type = 'button',
  variant = 'ghost',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  'aria-label': ariaLabel,
}: Props) {
  const base =
    'inline-flex items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900';

  // ghost variant uses IconButton-specific styles
  const getVariantStyle = (v: IconButtonVariant): string => {
    if (v === 'ghost') {
      return iconButtonGhostStyle;
    }
    return variantStyles[v];
  };

  const renderIcon = (iconElement: React.ReactNode) => {
    if (React.isValidElement(iconElement)) {
      const existingClassName =
        (iconElement.props as { className?: string }).className || '';
      return React.cloneElement(
        iconElement as React.ReactElement<{ className?: string }>,
        {
          className:
            `${iconButtonIconSizeStyles[size]} ${existingClassName}`.trim(),
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
      aria-label={ariaLabel}
      className={`${base} ${getVariantStyle(variant)} ${iconButtonSizeStyles[size]} ${disabledStyles} ${className}`}
    >
      {loading ? (
        <Loader2 className={`${iconButtonIconSizeStyles[size]} animate-spin`} />
      ) : (
        renderIcon(icon)
      )}
    </button>
  );
}

// Named export for convenience
export { IconButton };
