"use client";

type ToggleButtonProps = {
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  isEnabled: boolean;
  isLoading?: boolean;
  onToggle: () => void;
};

export function ToggleButton({
  label,
  description,
  icon: Icon,
  color = "violet",
  isEnabled,
  isLoading,
  onToggle,
}: ToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
        isEnabled
          ? `bg-${color}-100 dark:bg-${color}-900/30 text-${color}-700 dark:text-${color}-300 border border-${color}-200 dark:border-${color}-700`
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      }`}
      title={description}
    >
      <Icon
        className={`w-4 h-4 ${isEnabled ? `text-${color}-600 dark:text-${color}-400` : ""}`}
      />
      <span>{label}</span>
      <span
        className={`px-1.5 py-0.5 rounded text-xs ${
          isEnabled
            ? `bg-${color}-200 dark:bg-${color}-800 text-${color}-700 dark:text-${color}-200`
            : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {isEnabled ? "ON" : "OFF"}
      </span>
    </button>
  );
}
