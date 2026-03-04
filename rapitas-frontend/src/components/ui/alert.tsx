import React from 'react';
import { AlertCircle, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive' | 'success' | 'warning';
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    const variantStyles = {
      default: 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50',
      destructive: 'border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/10 dark:text-red-400',
      success: 'border-green-200 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-900/10 dark:text-green-400',
      warning: 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/10 dark:text-yellow-400'
    };

    return (
      <div
        ref={ref}
        role="alert"
        className={`relative w-full rounded-lg border p-4 ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className = '', ...props }, ref) => (
    <h5
      ref={ref}
      className={`mb-1 font-medium leading-none tracking-tight ${className}`}
      {...props}
    />
  )
);

AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`text-sm [&_p]:leading-relaxed ${className}`}
      {...props}
    />
  )
);

AlertDescription.displayName = 'AlertDescription';

// Convenience component for common alert patterns
export const AlertInfo = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <Alert>
    <AlertCircle className="h-4 w-4" />
    {title && <AlertTitle>{title}</AlertTitle>}
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

export const AlertError = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <Alert variant="destructive">
    <XCircle className="h-4 w-4" />
    {title && <AlertTitle>{title}</AlertTitle>}
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

export const AlertSuccess = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <Alert variant="success">
    <CheckCircle2 className="h-4 w-4" />
    {title && <AlertTitle>{title}</AlertTitle>}
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

export const AlertWarning = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <Alert variant="warning">
    <AlertTriangle className="h-4 w-4" />
    {title && <AlertTitle>{title}</AlertTitle>}
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);