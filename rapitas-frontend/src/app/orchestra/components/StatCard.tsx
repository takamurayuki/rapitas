/**
 * StatCard
 *
 * Single metric card displayed in the Orchestra page stats grid.
 * Pure presentational component with no state or side effects.
 */
'use client';

const COLOR_MAP: Record<string, string> = {
  yellow:
    'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  orange:
    'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
  green:
    'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}

/**
 * Renders a single stat metric with an icon, label, and numeric value.
 *
 * @param icon - Icon element displayed beside the label
 * @param label - Human-readable label string
 * @param value - Numeric value to display prominently
 * @param color - Theme color key (yellow | blue | orange | green | red)
 */
export function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border p-3 ${COLOR_MAP[color] || COLOR_MAP.blue}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </div>
    </div>
  );
}
