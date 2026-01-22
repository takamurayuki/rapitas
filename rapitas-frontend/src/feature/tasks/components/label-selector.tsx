"use client";
import { useEffect, useState } from "react";
import type { Label } from "@/types";
import { Check } from "lucide-react";
import { getIconComponent, ICON_DATA } from "@/components/category/icon-data";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type LabelSelectorProps = {
  selectedLabelIds: number[];
  onChange: (labelIds: number[]) => void;
  className?: string;
};

export default function LabelSelector({
  selectedLabelIds,
  onChange,
  className = "",
}: LabelSelectorProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const res = await fetch(`${API_BASE}/labels`);
        if (res.ok) {
          const data = await res.json();
          setLabels(data);
        }
      } catch (e) {
        console.error("Failed to fetch labels:", e);
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
    const IconComponent = getIconComponent(iconName || "");
    if (!IconComponent) {
      const DefaultIcon = ICON_DATA["Tag"].component;
      return <DefaultIcon size={size} />;
    }
    return <IconComponent size={size} />;
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
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
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const isSelected = selectedLabelIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => toggleLabel(label.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isSelected
                  ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-105 shadow-md"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                backgroundColor: isSelected ? label.color : `${label.color}20`,
                color: isSelected ? "#fff" : label.color,
                ["--tw-ring-color" as any]: label.color,
              }}
            >
              {renderIcon(label.icon, 14)}
              <span>{label.name}</span>
              {isSelected && <Check className="w-3.5 h-3.5 ml-0.5" />}
            </button>
          );
        })}
      </div>
      {selectedLabelIds.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {selectedLabelIds.length} 個のラベルを選択中
        </p>
      )}
    </div>
  );
}

// 選択済みラベルを表示するコンポーネント
type SelectedLabelsDisplayProps = {
  labels: Label[];
  className?: string;
};

export function SelectedLabelsDisplay({
  labels,
  className = "",
}: SelectedLabelsDisplayProps) {
  const renderIcon = (iconName: string | null | undefined, size = 14) => {
    const IconComponent = getIconComponent(iconName || "");
    if (!IconComponent) {
      const DefaultIcon = ICON_DATA["Tag"].component;
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
