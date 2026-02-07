interface LoadingSpinnerProps {
  message?: string;
  color?: string;
}

export const LoadingSpinner = ({
  message = "読み込み中...",
  color = "blue",
}: LoadingSpinnerProps) => {
  if (!message) return null;
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div
          className={`w-10 h-10 border-4 border-${color}-500 border-t-transparent rounded-full animate-spin`}
        />
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">{message}</p>
      </div>
    </div>
  );
};
