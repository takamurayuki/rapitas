import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';

type IconGridProps = {
  icons: string[];
  selectedIcon: string;
  onIconSelect: (iconName: string) => void;
  renderIcon: (iconName: string, size?: number) => React.ReactNode;
  accentClass?: string;
};

// Memoized individual icon button
const IconButton = memo(
  ({
    iconName,
    isSelected,
    onSelect,
    renderIcon,
    accentClass,
  }: {
    iconName: string;
    isSelected: boolean;
    onSelect: () => void;
    renderIcon: (iconName: string, size?: number) => React.ReactNode;
    accentClass?: string;
  }) => (
    <button
      type="button"
      onClick={onSelect}
      className={`p-2.5 rounded-lg transition-all ${
        isSelected
          ? `${accentClass || 'bg-purple-500'} text-white shadow-lg scale-105`
          : 'hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:scale-105'
      }`}
      title={iconName}
    >
      <div className="flex items-center justify-center">{renderIcon(iconName, 18)}</div>
    </button>
  ),
);

IconButton.displayName = 'IconButton';

// Icon grid component
export const IconGrid = memo(
  ({ icons, selectedIcon, onIconSelect, renderIcon, accentClass }: IconGridProps) => {
    if (icons.length === 0) {
      return (
        <div className="col-span-8 text-center py-6 text-sm text-zinc-500 dark:text-zinc-400">
          一致するアイコンがありません
        </div>
      );
    }

    return (
      <>
        {icons.map((iconName) => (
          <IconButton
            key={iconName}
            iconName={iconName}
            isSelected={selectedIcon === iconName}
            onSelect={() => onIconSelect(iconName)}
            renderIcon={renderIcon}
            accentClass={accentClass}
          />
        ))}
      </>
    );
  },
);

IconGrid.displayName = 'IconGrid';
