'use client';
import { useEffect, useState } from 'react';
import type { Label } from '@/types';
import { getIconComponent, ICON_DATA } from '@/components/category/IconData';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('LabelSelector');

type LabelSelectorProps = {
  selectedLabelIds: number[];
  onChange: (labelIds: number[]) => void;
  className?: string;
};

export default function LabelSelector({
  selectedLabelIds,
  onChange,
  className = '',
}: LabelSelectorProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/labels`);
        if (res.ok) {
          const data = await res.json();
          setLabels(data);
        }
      } catch (e) {
        logger.error('Failed to fetch labels:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchLabels();
  }, []);

  const toggleLabel = (labelId: number) => {
    if (selectedLabelIds.includes(labelId)) {
      onChange(selectedLabelIds.filter((id) => id !== labelId));
    } else {
      onChange([...selectedLabelIds, labelId]);
    }
  };

  const renderIcon = (iconName: string | null | undefined, size = 16) => {
    const IconComponent = getIconComponent(iconName || '');
    if (!IconComponent) {
      const DefaultIcon = ICON_DATA['Tag'].component;
      return <DefaultIcon size={size} />;
    }
    return <IconComponent size={size} />;
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-6 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className={`text-sm text-zinc-500 dark:text-zinc-400 ${className}`}>
        ラベルがありません。
        <a
          href="/labels"
          className="text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
        >
          ラベルを作成
        </a>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {labels.map((label) => {
          const isSelected = selectedLabelIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => toggleLabel(label.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                isSelected
                  ? 'ring-1 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900'
                  : 'opacity-60 hover:opacity-100'
              }`}
              style={
                {
                  backgroundColor: isSelected
                    ? label.color
                    : `${label.color}20`,
                  color: isSelected ? '#fff' : label.color,
                  ['--tw-ring-color' as keyof React.CSSProperties]: label.color,
                } as React.CSSProperties
              }
            >
              {renderIcon(label.icon, 10)}
              <span>{label.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Component to display selected labels
type SelectedLabelsDisplayProps = {
  labels: Label[];
  className?: string;
};

export function SelectedLabelsDisplay({
  labels,
  className = '',
}: SelectedLabelsDisplayProps) {
  const renderIcon = (iconName: string | null | undefined, size = 14) => {
    const IconComponent = getIconComponent(iconName || '');
    if (!IconComponent) {
      const DefaultIcon = ICON_DATA['Tag'].component;
      return <DefaultIcon size={size} />;
    }
    return <IconComponent size={size} />;
  };

  if (labels.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
          style={{
            backgroundColor: `${label.color}20`,
            color: label.color,
          }}
        >
          {renderIcon(label.icon, 12)}
          {label.name}
        </span>
      ))}
    </div>
  );
}
