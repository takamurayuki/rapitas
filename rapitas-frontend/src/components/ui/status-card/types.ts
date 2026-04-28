/**
 * AI agent status types
 */
export type AgentStatusType = 'processing' | 'waiting_for_input' | 'error' | 'completed';

/**
 * Status card size variants
 */
export type StatusCardSize = 'sm' | 'md' | 'lg';

/**
 * Status card theme options
 */
export type StatusCardTheme = 'light' | 'dark' | 'auto';

/**
 * Status configuration
 */
export type StatusConfig = {
  /** Icon color class */
  iconColor: string;
  /** Background color class */
  bgColor: string;
  /** Border color class */
  borderColor: string;
  /** Text color class */
  textColor: string;
  /** Status label */
  label: string;
  /** Animation class (optional) */
  animation?: string;
};

/**
 * StatusCard component props
 */
export type StatusCardProps = {
  /** Status type */
  status: AgentStatusType;
  /** Display message (optional) */
  message?: string;
  /** Card size */
  size?: StatusCardSize;
  /** Theme */
  theme?: StatusCardTheme;
  /** Custom class name */
  className?: string;
  /** Callback on status change */
  onStatusChange?: (status: AgentStatusType) => void;
  /** Enable animation */
  animated?: boolean;
  /** Custom icon (optional) */
  icon?: React.ReactNode;
  /** aria-label (accessibility) */
  ariaLabel?: string;
};
