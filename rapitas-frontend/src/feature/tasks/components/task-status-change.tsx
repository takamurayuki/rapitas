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
  size?: "sm" | "md";
}

export default function TaskStatusChange({
  status,
  currentStatus,
  config,
  renderIcon,
  onClick,
  size = "md",
}: TaskStatusChangeProps) {
  const isCurrent = currentStatus === status;
  const sizeClass = size === "sm" ? "w-6 h-6" : "w-7 h-7";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(status);
      }}
      className={`${sizeClass} rounded flex items-center justify-center transition-all ${
        isCurrent
          ? `${config.bgColor} ${config.color} ${size === "sm" ? "ring-1 ring-current" : ""}`
          : `hover:bg-${size === "sm" ? "zinc-200 dark:hover:bg-zinc-700" : "zinc-100 dark:hover:bg-zinc-800"} text-zinc-${size === "sm" ? "400 dark:text-zinc-500" : "300 dark:text-zinc-600"}`
      }`}
      title={config.label}
    >
      {renderIcon(status)}
    </button>
  );
}
