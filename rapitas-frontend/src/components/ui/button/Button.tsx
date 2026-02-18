'use client';
import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  ButtonVariant,
  ButtonSize,
  variantStyles,
  buttonSizeStyles,
  buttonIconSizeStyles,
  disabledStyles,
} from './buttonStyles';

export type { ButtonVariant, ButtonSize };

type Props = {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
};

export default function Button({
  onClick,
  children,
  className = '',
  title,
  type = 'button',
  variant = 'secondary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
}: Props) {
  const base =
    'inline-flex items-center justify-center font-medium rounded-lg border';

  const widthStyle = fullWidth ? 'w-full' : '';

  const renderIcon = (iconElement: React.ReactNode) => {
    if (React.isValidElement(iconElement)) {
      const existingClassName =
        (iconElement.props as { className?: string }).className || '';
      return React.cloneElement(
        iconElement as React.ReactElement<{ className?: string }>,
        {
          className:
            `${buttonIconSizeStyles[size]} ${existingClassName}`.trim(),
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
      className={`${base} ${variantStyles[variant]} ${buttonSizeStyles[size]} ${disabledStyles} ${widthStyle} ${className}`}
    >
      {loading && (
        <Loader2 className={`${buttonIconSizeStyles[size]} animate-spin`} />
      )}
      {!loading && icon && iconPosition === 'left' && renderIcon(icon)}
      {children}
      {!loading && icon && iconPosition === 'right' && renderIcon(icon)}
    </button>
  );
}

// Named export for convenience
export { Button };
