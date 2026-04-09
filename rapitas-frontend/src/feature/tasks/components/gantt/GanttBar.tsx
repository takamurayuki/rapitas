/**
 * GanttBar - 個別タスクのガントバー
 *
 * 1つのタスクを表すバーと、その上のラベル・ツールチップを描画する
 */

import React from 'react';
import type { GanttBarData } from './gantt-utils';

interface GanttBarProps {
  bar: GanttBarData;
  isOnCriticalPath?: boolean;
  onClick?: (taskId: number) => void;
  onHover?: (taskId: number | null) => void;
}

export function GanttBar({
  bar,
  isOnCriticalPath = false,
  onClick,
  onHover
}: GanttBarProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(bar.taskId);
  };

  const handleMouseEnter = () => {
    onHover?.(bar.taskId);
  };

  const handleMouseLeave = () => {
    onHover?.(null);
  };

  // ステータスに基づくスタイル調整
  const getBarStyle = () => {
    let baseClass = 'transition-all duration-200 ease-out cursor-pointer hover:opacity-80';

    if (isOnCriticalPath) {
      baseClass += ' ring-2 ring-red-400 ring-opacity-60';
    }

    if (bar.status === 'completed') {
      baseClass += ' opacity-70';
    }

    return baseClass;
  };

  // バーが短すぎる場合はテキストを表示しない
  const shouldShowText = bar.width > 60;

  return (
    <g>
      {/* バー本体 */}
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        fill={bar.color}
        className={getBarStyle()}
        rx={4} // 角丸
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />

      {/* バー内のテキスト（幅が十分な場合のみ） */}
      {shouldShowText && (
        <text
          x={bar.x + 8}
          y={bar.y + bar.height / 2 + 4}
          fill="white"
          fontSize="12"
          fontWeight="500"
          className="pointer-events-none select-none"
          textAnchor="start"
        >
          <tspan>{bar.title.length > 20 ? `${bar.title.slice(0, 17)}...` : bar.title}</tspan>
        </text>
      )}

      {/* ステータスインジケーター */}
      {bar.status === 'in_progress' && (
        <circle
          cx={bar.x + bar.width - 8}
          cy={bar.y + 8}
          r={4}
          fill="white"
          className="animate-pulse"
        />
      )}

      {bar.status === 'blocked' && (
        <g>
          <circle
            cx={bar.x + bar.width - 8}
            cy={bar.y + 8}
            r={6}
            fill="rgba(0,0,0,0.2)"
          />
          <text
            x={bar.x + bar.width - 8}
            y={bar.y + 8 + 3}
            fill="white"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
            className="pointer-events-none select-none"
          >
            !
          </text>
        </g>
      )}

      {/* クリティカルパスインジケーター */}
      {isOnCriticalPath && (
        <g>
          <circle
            cx={bar.x + 8}
            cy={bar.y - 6}
            r={4}
            fill="#EF4444"
          />
          <text
            x={bar.x + 8}
            y={bar.y - 6 + 3}
            fill="white"
            fontSize="8"
            fontWeight="bold"
            textAnchor="middle"
            className="pointer-events-none select-none"
          >
            !
          </text>
        </g>
      )}
    </g>
  );
}