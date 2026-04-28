interface TaskStatusChangeProps {
  status: string;
  currentStatus: string;
  config: {
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
  };
  renderIcon: (status: string) => React.ReactNode;
  onClick: (status: string) => void;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function TaskStatusChange({
  status,
  currentStatus,
  config,
  renderIcon,
  onClick,
  size = 'md',
  showLabel = false,
}: TaskStatusChangeProps) {
  const isCurrent = currentStatus === status;

  // Large button with label (for edit mode)
  if (showLabel) {
    const ringColor =
      status === 'todo'
        ? 'ring-zinc-400'
        : status === 'in-progress'
          ? 'ring-blue-500'
          : 'ring-green-500';

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(status);
        }}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all ${
          isCurrent
            ? `${config.bgColor} ${config.color} ${config.borderColor.replace('border-l-', 'border-')} ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${ringColor}`
            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-indigo-dark-900 text-zinc-500 dark:text-zinc-400'
        }`}
        title={config.label}
      >
        <span className={isCurrent ? config.color : ''}>{renderIcon(status)}</span>
        <span className="text-sm font-medium">{config.label}</span>
      </button>
    );
  }

  // Compact icon-only button (for list/view mode)
  const sizeClass = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';

  // Border color configuration
  const borderColor = config.borderColor.replace('border-l-', 'border-');

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(status);
      }}
      className={`${sizeClass} rounded flex items-center justify-center transition-all border ${
        isCurrent
          ? `${config.bgColor} ${config.color} ${borderColor}`
          : `border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500`
      }`}
      title={config.label}
    >
      {renderIcon(status)}
    </button>
  );
}
