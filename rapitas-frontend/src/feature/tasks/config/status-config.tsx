export const statusConfig = {
  todo: {
    color: "text-zinc-700 dark:text-zinc-300",
    bgColor: "bg-zinc-100 dark:bg-zinc-800",
    borderColor: "border-l-zinc-400 dark:border-l-zinc-600",
    label: "未着手",
  },
  "in-progress": {
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-50 dark:bg-blue-900/40",
    borderColor: "border-l-blue-500 dark:border-l-blue-400",
    label: "進行中",
  },
  done: {
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-50 dark:bg-green-900/40",
    borderColor: "border-l-green-500 dark:border-l-green-400",
    label: "完了",
  },
};

export const renderStatusIcon = (status: string) => {
  switch (status) {
    case "todo":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <rect
            x="3"
            y="10"
            width="18"
            height="4"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      );
    case "in-progress":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <rect
            x="3"
            y="10"
            width="18"
            height="4"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
          <rect x="3" y="10" width="10" height="4" rx="2" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    default:
      return null;
  }
};

export type StatusConfig = typeof statusConfig;
export type StatusKey = keyof StatusConfig;
